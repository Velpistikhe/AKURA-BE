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

