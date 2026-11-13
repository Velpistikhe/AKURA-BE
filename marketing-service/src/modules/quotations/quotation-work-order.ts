import { HttpError } from '../../utils/httpError.js';

export type MirroredWorkOrderStatus = 'DRAFT' | 'IN_PROGRESS' | 'COMPLETED';

/**
 * Maps a Field Service Work Order status for API responses. Canceled orders expose
 * no mirrored status; unknown values are rejected.
 */
export const workOrderStatusMirror = (status: string): MirroredWorkOrderStatus | null => {
  if (status === 'CANCELED') return null;
  if (status === 'DRAFT' || status === 'IN_PROGRESS' || status === 'COMPLETED') return status;
  throw new HttpError('Unsupported Work Order status', 400);
};

const snapshotStatus = (snapshot: unknown): string | null => {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;
  const status = (snapshot as Record<string, unknown>).status;
  return typeof status === 'string' ? status : null;
};

/** Read-only work order status derived from the stored snapshot, not a DB column. */
export const workOrderStatusFromSnapshot = (hasWorkOrder: boolean, workOrderSnapshot: unknown): MirroredWorkOrderStatus | null => {
  if (!hasWorkOrder && !workOrderSnapshot) return null;
  const status = snapshotStatus(workOrderSnapshot);
  if (!status) return null;
  return workOrderStatusMirror(status);
};

export const withQuotationWorkOrderFields = <T extends { hasWorkOrder: boolean; workOrderSnapshot: unknown }>(
  row: T,
): T & { workOrderStatus: MirroredWorkOrderStatus | null } => ({
  ...row,
  workOrderStatus: workOrderStatusFromSnapshot(row.hasWorkOrder, row.workOrderSnapshot),
});
