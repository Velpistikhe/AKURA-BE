import { env } from '../../config/env.js';
import { HttpError } from '../../utils/httpError.js';
import { serviceHeaders, serviceUrl } from '../../utils/serviceUrl.js';
import type { WorkOrderPublic } from './work-order.repository.js';

const mirrorPayload = (row: WorkOrderPublic, officeBranchId: string, revoked: boolean) => ({
  workOrderId: row.id,
  workOrderNumber: row.number,
  workOrderStatus: row.status,
  officeBranchId,
  revoked,
  workOrderSnapshot: { ...row },
});

export async function syncWorkOrderMirrorToMarketing(
  row: WorkOrderPublic,
  quotationId: string,
  officeBranchId: string,
  options: { revoked?: boolean; requestId?: string } = {},
): Promise<void> {
  if (!env.WORK_ORDER_SYNC_SECRET) return;
  const path = `marketing/internal/quotations/${quotationId}/work-order`;
  const body = mirrorPayload(row, officeBranchId, options.revoked === true);
  let response: globalThis.Response;
  try {
    response = await fetch(serviceUrl(path), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        'content-type': 'application/json',
        'x-work-order-sync-secret': env.WORK_ORDER_SYNC_SECRET,
        ...serviceHeaders(path),
        ...(options.requestId ? { 'x-request-id': options.requestId } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new HttpError('Marketing service is currently unavailable; retry later', 503);
  }
  if (!response.ok) {
    const status = [400, 404, 409, 422].includes(response.status) ? response.status : 503;
    throw new HttpError(
      status === 409
        ? 'Work order link conflicts with the current Marketing quotation state'
        : status === 404
          ? 'Quotation not found in Marketing'
          : 'Marketing service rejected the work order link update',
      status,
    );
  }
  const ack = await response.json() as { success?: boolean; workOrderId?: string };
  if (ack.success !== true || ack.workOrderId !== row.id) {
    throw new HttpError('Invalid work order link acknowledgment from Marketing', 502);
  }
}