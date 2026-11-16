import { prisma } from '../../config/db.js';
import { Actor } from '../../middlewares/actor.middleware.js';
import { HttpError } from '../../utils/httpError.js';
import { WorkOrderSyncQuery } from './work-order-sync.schemas.js';

/**
 * The delivery state of one synchronisation record.
 *
 * DELIVERED  - the receiver acknowledged the event.
 * PENDING    - the event is queued and has not been sent yet.
 * RETRYING   - the delivery failed and waits for its next retry.
 *
 * There is no permanent failure state: a delivery is retried until it is
 * acknowledged, so a failed attempt is always a retrying one.
 */
export type WorkOrderDeliveryStatus = 'DELIVERED' | 'PENDING' | 'RETRYING';

export const deliveryStatus = (delivery: { deliveredAt: Date | null; attempts: number }): WorkOrderDeliveryStatus => {
  if (delivery.deliveredAt) return 'DELIVERED';
  return delivery.attempts > 0 ? 'RETRYING' : 'PENDING';
};

/**
 * Reads the recorded Marketing synchronisation of one Work Order.
 *
 * Field Service owns the outbox, so this reads the local delivery history
 * only. Every row is scoped to the branch of the caller, and the Work Order
 * itself is checked first, so a Work Order of another branch is reported as
 * missing rather than as an empty list.
 */
export const workOrderSyncRepository = {
  async list(workOrderId: string, input: WorkOrderSyncQuery, actor: Actor) {
    const { page, limit } = input;
    const workOrder = await prisma.workOrder.findFirst({
      where: { id: workOrderId, officeBranchId: actor.officeBranchId },
      select: { id: true },
    });
    if (!workOrder) throw new HttpError('Work order not found', 404);
    const where = { workOrderId, officeBranchId: actor.officeBranchId };
    const [events, total] = await prisma.$transaction([
      prisma.workOrderLinkEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: { deliveries: { orderBy: { id: 'asc' } } },
      }),
      prisma.workOrderLinkEvent.count({ where }),
    ], { isolationLevel: 'RepeatableRead' });
    const records = events.flatMap(event => event.deliveries.map(delivery => ({
      eventId: event.id,
      workOrderId: event.workOrderId,
      workOrderNumber: event.workOrderNumber,
      workOrderStatus: event.workOrderStatus,
      action: event.action,
      revoked: event.revoked,
      quotationId: event.quotationId,
      officeBranchId: event.officeBranchId,
      createdAt: event.createdAt,
      delivery: {
        id: delivery.id,
        targetService: delivery.targetService,
        attempts: delivery.attempts,
        nextRetryAt: delivery.nextRetryAt,
        deliveredAt: delivery.deliveredAt,
        lastError: delivery.lastError,
        deliveryStatus: deliveryStatus(delivery),
      },
    })));
    return { sync: records, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },
};