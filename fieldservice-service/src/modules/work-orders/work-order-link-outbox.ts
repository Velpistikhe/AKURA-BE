import { Prisma } from '@prisma/client';
import { env } from '../../config/env.js';

type WorkOrderRow = {
  id: string;
  number: string;
  status: string;
  quotationId: string | null;
  officeBranchId: string;
  revoked: boolean;
} & Record<string, unknown>;

/** The Work Order write that produced a link event. */
export type WorkOrderLinkAction = 'CREATE' | 'START' | 'UPDATE' | 'REVOKE';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

/**
 * Commits a Marketing link delivery in the same transaction as the Work Order write.
 *
 * The Work Order identity is stored in indexed columns next to the payload, so
 * the synchronisation history of one Work Order can be read without scanning
 * the JSONB document.
 */
export async function enqueueWorkOrderLink(
  tx: Prisma.TransactionClient,
  workOrder: WorkOrderRow,
  options: { revoked?: boolean; action?: WorkOrderLinkAction } = {},
) {
  if (!workOrder.quotationId || !env.WORK_ORDER_SYNC_SECRET) return null;
  const revoked = options.revoked === true;
  const action = options.action ?? (revoked ? 'REVOKE' : 'UPDATE');
  const snapshot = json(workOrder);
  const payload = {
    workOrderId: workOrder.id,
    workOrderNumber: workOrder.number,
    workOrderStatus: workOrder.status,
    officeBranchId: workOrder.officeBranchId,
    revoked,
    workOrderSnapshot: snapshot,
  };
  return tx.workOrderLinkEvent.create({
    data: {
      quotationId: workOrder.quotationId,
      officeBranchId: workOrder.officeBranchId,
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.number,
      workOrderStatus: workOrder.status,
      action,
      revoked,
      payload,
      deliveries: { create: [{ targetService: 'marketing' }] },
    },
  });
}
