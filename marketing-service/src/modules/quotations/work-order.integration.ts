import { Request } from 'express';
import { z } from 'zod';
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
 * A contract-based Work Order read live from Field Service. It is the source
 * document of a Flow 3 billing quotation: the Work Order was executed against
 * a contract, and the quotation is raised afterwards only to bill that work.
 *
 * The response is reduced to the fields the billing quotation needs, so no
 * Field Service internal column can reach the quotation. The branch always
 * comes from the caller's access token, never from the client.
 */
export const workOrderBasisSchema = z.object({
  id: z.string().uuid(),
  number: z.string().min(1).max(100),
  officeBranchId: z.string().uuid(),
  status: z.enum(['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELED']),
  revoked: z.boolean(),
  quotationId: z.string().uuid().nullable(),
  contractId: z.string().uuid().nullable(),
  contractSnapshot: z.object({
    id: z.string().uuid(),
    version: z.number().int().nonnegative(),
    contractNumber: z.string().min(1),
    contractDate: z.string(),
    effectiveFrom: z.string(),
    effectiveUntil: z.string(),
    companyId: z.string().uuid(),
    companyName: z.string().min(1),
  }).passthrough().nullable(),
  items: z.array(z.object({
    itemSizeId: z.string().uuid(),
    quantityInspection: z.union([z.string(), z.number()]).transform(value => String(value)),
    quantityMaintenance: z.union([z.string(), z.number()]).transform(value => String(value)),
  }).passthrough()),
}).passthrough();
export type WorkOrderBasis = z.infer<typeof workOrderBasisSchema>;

/**
 * Reads one Work Order from Field Service for the caller's branch. The Work
 * Order must be contract-based and not revoked: only that combination can
 * become a billing quotation (Flow 3).
 */
export async function loadContractWorkOrder(req: Request, workOrderId: string, officeBranchId: string): Promise<WorkOrderBasis> {
  const result = await requestFieldService(fieldServicePath(`work-orders/${workOrderId}`), req);
  if (!result || typeof result !== 'object') throw new HttpError('Work Order not found', 404);
  const parsed = workOrderBasisSchema.safeParse(result);
  if (!parsed.success) throw new HttpError('Invalid Work Order response', 502);
  const workOrder = parsed.data;
  if (workOrder.id !== workOrderId || workOrder.officeBranchId !== officeBranchId)
    throw new HttpError('Work Order not found in this branch', 404);
  if (workOrder.revoked) throw new HttpError('Work Order is revoked', 409);
  if (!workOrder.contractId || !workOrder.contractSnapshot)
    throw new HttpError('A billing quotation requires a contract-based Work Order', 409);
  if (workOrder.quotationId)
    throw new HttpError('Work Order already has a quotation', 409);
  if (workOrder.status !== 'COMPLETED') throw new HttpError('Work Order must be COMPLETED before creating a billing quotation', 409);
  return workOrder;
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

/**
 * Flow 3: a billing quotation raised from a contract Work Order carries
 * sourceWorkOrderId. Before billing, that Work Order must still be live and
 * COMPLETED, so an invoice can never bill work that was revoked or unfinished.
 * The Work Order is read by id; upstream failure is fail-closed (503).
 */
export async function assertSourceWorkOrderCompleted(req: Request, workOrderId: string, branch: string): Promise<void> {
  const result = await requestFieldService(fieldServicePath(`work-orders/by-id/${workOrderId}`), req);
  if (!result || typeof result !== 'object') throw new HttpError('Source Work Order not found', 404);
  const row = result as WorkOrderPayload & { status: string };
  if (row.id !== workOrderId || row.officeBranchId !== branch) throw new HttpError('Source Work Order not found in this branch', 404);
  if (row.revoked !== false) throw new HttpError('Source Work Order is revoked', 409);
  if (row.status !== 'COMPLETED') throw new HttpError('Work Order must be COMPLETED before billing', 409);
}
