import { Request } from 'express';
import { getAccessToken } from '../../utils/requestTokens.js';
import { serviceHeaders, serviceUrl } from '../../utils/serviceUrl.js';
import { HttpError } from '../../utils/httpError.js';

const fieldServicePath = (suffix: string) => `fieldservice/${suffix}`;
type WorkOrderPayload = { id: string; quotationId: string | null; officeBranchId: string; revoked: boolean };

async function requestFieldService(path: string, req: Request, init: RequestInit = {}): Promise<unknown> {
  const token = getAccessToken(req);
  if (!token) throw new HttpError('Access token is required', 401);
  let response: globalThis.Response;
  try {
    response = await fetch(serviceUrl(path), {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        authorization: `Bearer ${token}`,
        ...serviceHeaders(path),
        ...(typeof req.headers['x-request-id'] === 'string' ? { 'x-request-id': req.headers['x-request-id'] } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new HttpError('Field Service is unavailable; retry later', 503);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    const status = [400, 401, 403, 404, 409].includes(response.status) ? response.status : 503;
    throw new HttpError(body?.message || 'Unable to validate Work Order with Field Service', status);
  }
  try { return (await response.json() as { data: unknown }).data; }
  catch { throw new HttpError('Invalid response from Field Service', 502); }
}

/**
 * Live Work Order lookup used before a quotation revision. Returns true only
 * when Field Service confirms a non-revoked Work Order for the exact quotation
 * and branch; upstream failure is fail-closed (503), never a silent false.
 */
export async function hasActiveWorkOrder(req: Request, quotationId: string, officeBranchId: string): Promise<boolean> {
  const path = fieldServicePath(`work-orders/by-quotation/${quotationId}`);
  const result = await requestFieldService(path, req);
  if (!result) return false;
  if (typeof result !== 'object') throw new HttpError('Invalid response from Field Service', 502);
  const row = result as WorkOrderPayload;
  if (row.quotationId !== quotationId || row.officeBranchId !== officeBranchId || row.revoked !== false || !row.id) {
    throw new HttpError('Work Order reference does not match this quotation and branch', 502);
  }
  return true;
}

/**
 * Compensation used when Marketing fails to persist the link after Field Service
 * already created the Work Order. The Work Order is revoked in Field Service so
 * the quotation is not left pointing at a live Work Order. Field Service derives
 * the branch from the forwarded token, so the call stays branch scoped.
 */
export async function notifyFieldServiceWorkOrderRevoked(workOrderId: string, version: number, req: Request): Promise<void> {
  const path = fieldServicePath(`work-orders/${workOrderId}`);
  const token = getAccessToken(req);
  if (!token) throw new HttpError('Access token is required', 401);
  let response: globalThis.Response;
  try {
    response = await fetch(serviceUrl(path), {
      method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...serviceHeaders(path),
        ...(typeof req.headers['x-request-id'] === 'string' ? { 'x-request-id': req.headers['x-request-id'] } : {}) },
      body: JSON.stringify({ version }),
    });
  } catch { throw new HttpError('Field Service is unavailable; retry later', 503); }
  if (!response.ok) throw new HttpError('Unable to revoke Work Order after quotation update failure', [404, 409].includes(response.status) ? response.status : 503);
}

export async function assertBillingWorkOrderCompleted(req: Request, quotationId: string, branch: string): Promise<void> {
  const result = await requestFieldService(fieldServicePath(`work-orders/by-quotation/${quotationId}`), req);
  if (!result) return;
  const row = result as WorkOrderPayload & { status: string };
  if (row.quotationId !== quotationId || row.officeBranchId !== branch || row.revoked !== false || !row.id
    || !['DRAFT', 'IN_PROGRESS', 'COMPLETED'].includes(row.status)) throw new HttpError('Invalid Work Order reference', 502);
  if (row.status !== 'COMPLETED') throw new HttpError('Work Order must be COMPLETED before billing', 409);
}
