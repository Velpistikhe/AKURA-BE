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

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

/** Commits a Marketing link delivery in the same transaction as the Work Order write. */
export async function enqueueWorkOrderLink(
  tx: Prisma.TransactionClient,
  workOrder: WorkOrderRow,
  options: { revoked?: boolean } = {},
) {
  if (!workOrder.quotationId || !env.WORK_ORDER_SYNC_SECRET) return null;
  const revoked = options.revoked === true;
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
      payload,
      deliveries: { create: [{ targetService: 'marketing' }] },
    },
  });
}
