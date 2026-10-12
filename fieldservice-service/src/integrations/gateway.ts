import { Request } from 'express';
import { AuthenticatedRequest } from '../types/auth.types.js';
import { z } from 'zod';
import { serviceUrl, serviceHeaders } from '../utils/serviceUrl.js';
import { getAccessToken } from '../utils/requestTokens.js';
import { HttpError } from '../utils/httpError.js';

export async function gatewayGet(path: string, req: Request): Promise<unknown> {
  const token = getAccessToken(req);
  if (!token) throw new HttpError('Access token is required', 401);
  const user = (req as AuthenticatedRequest).user;
  if (!user) throw new HttpError('Verified user is required', 401);
  let response: globalThis.Response;
  try {
    response = await fetch(serviceUrl(path), {
      headers: { Authorization: `Bearer ${token}`, ...serviceHeaders(path),
        'x-request-id': String(req.headers['x-request-id'] ?? '') },
      signal: AbortSignal.timeout(5000),
    });
  } catch { throw new HttpError('Referenced service is unavailable; retry later', 503); }
  if (!response.ok) {
    const status = [401, 403, 404, 409].includes(response.status) ? response.status : 503;
    throw new HttpError(status === 404 ? 'Referenced record not found' : 'Unable to validate reference with upstream service', status);
  }
  try { return (await response.json() as { data: unknown }).data; }
  catch { throw new HttpError('Invalid response from referenced service', 502); }
}
const money = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/);
export const quotationSchema = z.object({
  id: z.string().uuid(), officeBranchId: z.string().uuid(), version: z.number().int().nonnegative(),
  // Boolean (not literal true) so lifecycle snapshots such as REVISED can also be stored.
  isActive: z.boolean(), no: z.number().int(), numberYear: z.number().int(),
  status: z.string(),
  subject: z.string(), companySnapshot: z.record(z.unknown()), customerSnapshot: z.string(),
  subTotal: money, taxAmount: money, total: money, items: z.array(z.record(z.unknown())),
}).passthrough();
export type QuotationSnapshot = z.infer<typeof quotationSchema>;
/**
 * Live Marketing validation used when a quotation-based Work order starts.
 * Marketing is the source of truth: network failure/timeout/5xx means Marketing
 * is unavailable (503); a 404 or any inactive/non-approved quotation means the
 * local snapshot no longer matches Marketing (409 mismatch).
 */
export async function loadQuotationForStart(req: Request, id: string, branch: string): Promise<QuotationSnapshot> {
  const token = getAccessToken(req);
  if (!token) throw new HttpError('Access token is required', 401);
  const user = (req as AuthenticatedRequest).user;
  if (!user) throw new HttpError('Verified user is required', 401);
  const path = `marketing/quotation-references/${id}`;
  const mismatch = 'Work order quotation snapshot does not match Marketing data; reload the quotation';
  let response: globalThis.Response;
  try {
    response = await fetch(serviceUrl(path), {
      headers: { Authorization: `Bearer ${token}`, ...serviceHeaders(path),
        'x-request-id': String(req.headers['x-request-id'] ?? '') },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new HttpError('Marketing service is currently unavailable; retry later', 503);
  }
  // 404 means Marketing no longer exposes the quotation (inactive, revised or
  // removed): the stored snapshot has drifted from the source of truth.
  if (response.status === 404) throw new HttpError(mismatch, 409);
  if (response.status === 401 || response.status === 403) throw new HttpError('Unable to validate the quotation with Marketing service', response.status);
  if (!response.ok) throw new HttpError('Marketing service is currently unavailable; retry later', 503);
  let payload: unknown;
  try { payload = (await response.json() as { data: unknown }).data; }
  catch { throw new HttpError('Invalid response from Marketing service', 502); }
  const parsed = quotationSchema.safeParse(payload);
  if (!parsed.success) throw new HttpError('Invalid Marketing quotation response', 502);
  const quotation = parsed.data;
  if (quotation.id !== id || quotation.officeBranchId !== branch) throw new HttpError(mismatch, 409);
  if (!quotation.isActive || quotation.status !== 'APPROVED') throw new HttpError(mismatch, 409);
  if (quotation.items.some(item => (item.priceSelection as Record<string, unknown> | null)?.priceSource === 'CONTRACT'))
    throw new HttpError(mismatch, 409);
  return quotation;
}

export const inspectorReferenceSchema = z.object({ id: z.string().uuid(), name: z.string().min(1).max(255) });
export type InspectorReference = z.infer<typeof inspectorReferenceSchema>;
const inspectorListSchema = z.object({ inspectors: z.array(inspectorReferenceSchema) });
export type StoredInspector = { userId: string | null; name: string };
/**
 * Live Auth validation used before a Work order starts. Auth is the source of
 * truth for FIELD_SERVICE users: the stored inspector snapshot (id + display
 * name resolved from the local FieldServiceUser read model at creation time)
 * must still exist in Auth as an active FIELD_SERVICE user of the caller branch
 * with the same canonical display name. Network failure/timeout means Auth is
 * unavailable (503); any missing user or name drift means the stored snapshot
 * no longer matches Auth (409 mismatch).
 *
 * The upstream call runs before the status transaction, never holding locks.
 * Rows without a userId (legacy name-only rows) are skipped.
 */
export async function validateInspectorsForStart(req: Request, inspectors: StoredInspector[]): Promise<void> {
  const ids = [...new Set(inspectors.flatMap(row => row.userId ? [row.userId] : []))];
  if (ids.length === 0) return;
  const token = getAccessToken(req);
  if (!token) throw new HttpError('Access token is required', 401);
  const user = (req as AuthenticatedRequest).user;
  if (!user) throw new HttpError('Verified user is required', 401);
  const path = 'auth/users/field-service/inspectors';
  const mismatch = 'Work order inspectors do not match Auth user data; reload the inspectors before starting';
  let response: globalThis.Response;
  try {
    response = await fetch(`${serviceUrl(path)}?ids=${encodeURIComponent(ids.join(','))}`, {
      headers: { Authorization: `Bearer ${token}`, ...serviceHeaders(path),
        'x-request-id': String(req.headers['x-request-id'] ?? '') },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new HttpError('Auth service is currently unavailable; retry later', 503);
  }
  if (response.status === 401 || response.status === 403) throw new HttpError('Unable to validate the inspectors with Auth service', response.status);
  if (!response.ok) throw new HttpError('Auth service is currently unavailable; retry later', 503);
  let payload: unknown;
  try { payload = (await response.json() as { data: unknown }).data; }
  catch { throw new HttpError('Invalid response from Auth service', 502); }
  const parsed = inspectorListSchema.safeParse(payload);
  if (!parsed.success) throw new HttpError('Invalid Auth inspector response', 502);
  const authById = new Map(parsed.data.inspectors.map(({ id, name }) => [id, name]));
  // Auth only returns active FIELD_SERVICE users of the caller branch, so a
  // missing ID means the user was removed, deactivated or moved to another branch.
  if (ids.some(id => !authById.has(id))) throw new HttpError(mismatch, 409);
  for (const { userId, name } of inspectors) {
    if (userId && authById.get(userId) !== name) throw new HttpError(mismatch, 409);
  }
}

export async function loadQuotation(req: Request, id: string, version: number, branch: string): Promise<QuotationSnapshot> {
  const parsed = quotationSchema.safeParse(await gatewayGet(`marketing/quotation-references/${id}`, req));
  if (!parsed.success) throw new HttpError('Invalid quotation response', 502);
  const quotation = parsed.data;
  if (quotation.id !== id || quotation.officeBranchId !== branch) throw new HttpError('Quotation not found', 404);
  if (quotation.version !== version) throw new HttpError('Quotation has changed; reload before saving the Work order', 409);
  if (quotation.status !== 'APPROVED') throw new HttpError('Work order requires an APPROVED quotation', 409);
  if (quotation.items.some(item => (item.priceSelection as Record<string, unknown> | null)?.priceSource === 'CONTRACT')) throw new HttpError('Use the contract as the work order basis for contract pricing', 409);
  return quotation;
}

export const contractSchema = z.object({
  id: z.string().uuid(), version: z.number().int().nonnegative(), companyId: z.string().uuid(),
  isActive: z.boolean(), status: z.string(), effectiveFrom: z.string().datetime(), effectiveUntil: z.string().datetime(),
  company: z.object({ id: z.string().uuid(), officeBranchId: z.string().uuid(), revoked: z.boolean() }).passthrough(),
}).passthrough();
export type ContractSnapshot = z.infer<typeof contractSchema>;
export async function loadCompanyContract(req: Request, companyId: string, branch: string): Promise<ContractSnapshot> {
  const parsed = contractSchema.safeParse(await gatewayGet(`marketing/company-contract-references/${companyId}`, req));
  if (!parsed.success) throw new HttpError('Invalid contract response', 502);
  const contract = parsed.data;
  if (contract.companyId !== companyId || contract.company.id !== companyId || contract.company.officeBranchId !== branch)
    throw new HttpError('Company contract not found', 404);
  validateContract(contract);
  return contract;
}
export async function loadContract(req: Request, id: string, branch: string) {
  const parsed = contractSchema.safeParse(await gatewayGet(`marketing/contract-references/${id}`, req));
  if (!parsed.success) throw new HttpError('Invalid contract response', 502);
  const contract = parsed.data;
  if (contract.id !== id || contract.company.officeBranchId !== branch || contract.company.id !== contract.companyId) throw new HttpError('Contract not found', 404);
  validateContract(contract);
  return contract;
}
export function validateContract(contract: ContractSnapshot) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  if (!contract.isActive || contract.status !== 'ACTIVE' || contract.company.revoked
    || contract.effectiveFrom.slice(0, 10) > today || contract.effectiveUntil.slice(0, 10) <= today)
    throw new HttpError('Work order requires an ACTIVE contract within its effective period', 409);
}
