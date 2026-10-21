import { Request } from 'express';
import { AuthenticatedRequest } from '../types/auth.types.js';
import { z } from 'zod';
import { serviceUrl, serviceHeaders } from '../utils/serviceUrl.js';
import { getAccessToken } from '../utils/requestTokens.js';
import { HttpError } from '../utils/httpError.js';
import { env } from '../config/env.js';

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
const dateTime = z.string().datetime();
// Item shape returned by GET marketing/quotation-references/:id. Price fields are
// validated here so an incomplete upstream payload still fails as 502, but they are
// deliberately dropped by toQuotationSnapshot and never persisted.
const quotationItemSchema = z.object({
  id: z.string().uuid(), itemSizeId: z.string().uuid(), position: z.number().int(),
  serviceName: z.string(), serviceType: z.string(), itemName: z.string(),
  size: z.string().nullish(), note: z.string().nullish(),
  quantityInspection: z.string(), quantityMaintenance: z.string(),
  priceInspection: money, priceMaintenance: money.nullable(), subTotal: money,
  priceSelection: z.record(z.unknown()).nullable(), isActive: z.boolean(), version: z.number().int(),
}).passthrough();
// Quotation header returned by GET marketing/quotation-references/:id. Tax and total
// fields are validated but excluded from the persisted snapshot by toQuotationSnapshot.
export const quotationSchema = z.object({
  id: z.string().uuid(), officeBranchId: z.string().uuid(), version: z.number().int().nonnegative(),
  // Boolean (not literal true) so lifecycle snapshots such as REVISED can also be stored.
  isActive: z.boolean(),
  // Numbering is assigned only at approval, so a pre-approval quotation legitimately
  // arrives with no/numberYear null and must still fail as "not APPROVED", not as 502.
  no: z.number().int().nullable(), numberYear: z.number().int().nullable(),
  status: z.string(), revision: z.number().int().nonnegative(),
  date: dateTime.nullable(), jobStart: z.string(), inquiryMethod: z.string(), inquiryDate: dateTime,
  subject: z.string(), termOfPayment: z.string(), validity: z.string(),
  supplyAkura: z.string(), supplyCustomer: z.string(), location: z.string(), accomplished: z.string(),
  deliveryReports: z.string(), deliveryInvoice: z.string(), staffId: z.string().uuid(),
  customerSnapshot: z.string(), companySnapshot: z.record(z.unknown()),
  subTotal: money, taxAmount: money, total: money, createdAt: dateTime, updatedAt: dateTime,
  items: z.array(quotationItemSchema),
}).passthrough();
export type QuotationSnapshot = z.infer<typeof quotationSchema>;
// The exact quotation fields a Work Order stores: identity, lifecycle and descriptive
// content. Prices are absent by construction.
const quotationItemSnapshotKeys = [
  'id', 'itemSizeId', 'position', 'serviceName', 'serviceType', 'itemName',
  'size', 'note', 'quantityInspection', 'quantityMaintenance', 'isActive', 'version',
] as const;
const quotationSnapshotKeys = [
  'id', 'officeBranchId', 'no', 'numberYear', 'revision', 'date', 'jobStart', 'inquiryMethod',
  'inquiryDate', 'subject', 'termOfPayment', 'validity', 'supplyAkura', 'supplyCustomer',
  'location', 'accomplished', 'deliveryReports', 'deliveryInvoice', 'customerSnapshot',
  'companySnapshot', 'staffId', 'status', 'isActive', 'version', 'createdAt', 'updatedAt',
] as const;
export type WorkOrderQuotationSnapshot =
  Pick<QuotationSnapshot, typeof quotationSnapshotKeys[number]>
  & { items: Pick<QuotationSnapshot['items'][number], typeof quotationItemSnapshotKeys[number]>[] };
/**
 * Reduces a live Marketing quotation to what a Work Order stores: identity, lifecycle
 * and descriptive content plus its items, with every price excluded (header
 * subTotal/taxAmount/total, item priceInspection/priceMaintenance/subTotal/priceSelection).
 *
 * Keys are projected through an explicit allowlist rather than a rest-spread, so the
 * upstream passthrough() payload cannot leak an extra Marketing column into the column,
 * and no price field can be stored by accident.
 */
export function toQuotationSnapshot(quotation: QuotationSnapshot): WorkOrderQuotationSnapshot {
  return {
    ...Object.fromEntries(quotationSnapshotKeys.map(key => [key, quotation[key]])),
    items: quotation.items.map(item =>
      Object.fromEntries(quotationItemSnapshotKeys.map(key => [key, item[key]]))),
  } as WorkOrderQuotationSnapshot;
}
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
 * Notifies Marketing that a Work Order was revoked so the quotation reference
 * is cleared on the Marketing side. The callback runs inside the revoke
 * transaction: a failure aborts the transaction, so the Work Order stays live
 * and both services keep agreeing on the quotation state.
 */
export async function notifyMarketingWorkOrderRevoked(workOrder: { id: string; quotationId: string | null; officeBranchId: string }, req: Request): Promise<void> {
  if (!workOrder.quotationId) return;
  if (!env.WORK_ORDER_SYNC_SECRET) throw new HttpError('Work Order callback credentials are not configured', 503);
  const callbackPath = 'marketing/internal/work-orders/events';
  let response: globalThis.Response;
  try {
    response = await fetch(serviceUrl(callbackPath), {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'content-type': 'application/json', 'x-work-order-sync-secret': env.WORK_ORDER_SYNC_SECRET,
        ...serviceHeaders(callbackPath), ...(typeof req.headers['x-request-id'] === 'string' ? { 'x-request-id': req.headers['x-request-id'] } : {}) },
      body: JSON.stringify({ workOrderId: workOrder.id, quotationId: workOrder.quotationId, officeBranchId: workOrder.officeBranchId,
        revoked: true, workOrderSnapshot: { ...workOrder, revoked: true } }),
    });
  } catch { throw new HttpError('Marketing Service is unavailable; Work Order revoke was not applied', 503); }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new HttpError(body?.message || 'Marketing Service rejected the Work Order revoke', response.status === 404 || response.status === 409 ? response.status : 503);
  }
  const acknowledgment = await response.json().catch(() => null) as { success?: boolean; workOrderId?: string } | null;
  if (acknowledgment?.success !== true || acknowledgment.workOrderId !== workOrder.id) {
    throw new HttpError('Invalid acknowledgment from Marketing Service; Work Order revoke was not applied', 502);
  }
}

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

export async function loadQuotationForBasis(req: Request, id: string, branch: string): Promise<QuotationSnapshot> {
  const parsed = quotationSchema.safeParse(await gatewayGet(`marketing/quotation-references/${id}`, req));
  if (!parsed.success) throw new HttpError('Invalid quotation response', 502);
  const quotation = parsed.data;
  if (quotation.id !== id || quotation.officeBranchId !== branch) throw new HttpError('Quotation not found', 404);
  if (!quotation.isActive || quotation.status !== 'APPROVED') throw new HttpError('Work order requires an APPROVED quotation', 409);
  if (quotation.items.some(item => (item.priceSelection as Record<string, unknown> | null)?.priceSource === 'CONTRACT')) throw new HttpError('Use contract as the work order basis for contract pricing', 409);
  return quotation;
}

export const quotationReferenceOptionSchema = z.object({
  id: z.string().uuid(), officeBranchId: z.string().uuid(),
  no: z.number().int().nullable(), numberYear: z.number().int().nullable(),
  subject: z.string(), companySnapshot: z.record(z.unknown()),
  version: z.number().int().nonnegative(), revision: z.number().int().nonnegative(),
  approvedAt: z.string().datetime().nullable(),
}).passthrough();
export type QuotationReferenceOption = z.infer<typeof quotationReferenceOptionSchema>;

/** Branch-scoped list of APPROVED, active, non-contract-priced quotation options. */
export async function loadQuotationOptions(req: Request): Promise<QuotationReferenceOption[]> {
  const parsed = z.object({ quotations: z.array(quotationReferenceOptionSchema) }).passthrough()
    .safeParse(await gatewayGet('marketing/quotation-references', req));
  if (!parsed.success) throw new HttpError('Invalid quotation reference list response', 502);
  return parsed.data.quotations;
}

export const contractSchema = z.object({
  id: z.string().uuid(), version: z.number().int().nonnegative(), companyId: z.string().uuid(),
  isActive: z.boolean(), status: z.string(), effectiveFrom: z.string().datetime(), effectiveUntil: z.string().datetime(),
  contractNumber: z.string().min(1), contractDate: z.string().datetime(),
  company: z.object({ id: z.string().uuid(), name: z.string().min(1), officeBranchId: z.string().uuid(), revoked: z.boolean() }).passthrough(),
}).passthrough();
export type ContractSnapshot = z.infer<typeof contractSchema>;
/**
 * The only contract fields persisted on a Work Order. An explicit projection (not
 * a spread or a pick of known keys) so the upstream price rows, company record and
 * any future Marketing column can never leak into the snapshot column.
 */
export type WorkOrderContractSnapshot = {
  id: string; version: number; contractNumber: string; contractDate: string;
  effectiveFrom: string; effectiveUntil: string; companyId: string; companyName: string;
};
export function toContractSnapshot(contract: ContractSnapshot): WorkOrderContractSnapshot {
  return {
    id: contract.id, version: contract.version, contractNumber: contract.contractNumber,
    contractDate: contract.contractDate, effectiveFrom: contract.effectiveFrom,
    effectiveUntil: contract.effectiveUntil, companyId: contract.companyId, companyName: contract.company.name,
  };
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
  // Marketing's CompanyContractStatus is DRAFT|SUBMITTED|REJECTED|APPROVED|REVISED|TERMINATED,
  // so APPROVED (not ACTIVE) is the only live state of a contract.
  if (!contract.isActive || contract.status !== 'APPROVED' || contract.company.revoked
    || contract.effectiveFrom.slice(0, 10) > today || contract.effectiveUntil.slice(0, 10) <= today)
    throw new HttpError('Work order requires an APPROVED contract within its effective period', 409);
}
