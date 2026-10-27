import { financeQuotationSchema } from '../modules/documents/document.schemas.js';
import { Request } from 'express';
import { AuthenticatedRequest } from '../types/auth.types.js';
import { z } from 'zod';
import { serviceUrl, serviceHeaders } from '../utils/serviceUrl.js';
import { getAccessToken } from '../utils/requestTokens.js';
import { HttpError } from '../utils/httpError.js';

export async function gatewayGet(path: string, req: Request, body?: unknown): Promise<unknown> {
  const token = getAccessToken(req);
  if (!token) throw new HttpError('Access token is required', 401);
  const user = (req as AuthenticatedRequest).user;
  if (!user) throw new HttpError('Verified user is required', 401);
  let response: globalThis.Response;
  try {
    response = await fetch(serviceUrl(path), {
      ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body), redirect: 'error' as const }),
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}`, ...serviceHeaders(path),
        'x-request-id': String(req.headers['x-request-id'] ?? '') },
      signal: AbortSignal.timeout(5000),
    });
  } catch { throw new HttpError('Referenced service is unavailable; retry later', 503); }
  if (!response.ok) {
    const status = [400, 401, 403, 404, 409].includes(response.status) ? response.status : 503;
    throw new HttpError(status === 404 ? 'Referenced record not found' : 'Unable to validate reference with upstream service', status);
  }
  try { return (await response.json() as { data: unknown }).data; }
  catch { throw new HttpError('Invalid response from referenced service', 502); }
}
const money = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/);
export const quotationSchema = z.object({
  id: z.string().uuid(), officeBranchId: z.string().uuid(), version: z.number().int().nonnegative(),
  isActive: z.literal(true), no: z.number().int(), numberYear: z.number().int(),
  subject: z.string(), companySnapshot: z.record(z.unknown()), customerSnapshot: z.string(),
  subTotal: money, taxAmount: money, total: money, items: z.array(z.record(z.unknown())),
}).passthrough();
export type QuotationSnapshot = z.infer<typeof quotationSchema>;
export const marketingQuotationSchema = financeQuotationSchema;
export type MarketingQuotation = z.infer<typeof marketingQuotationSchema>;
/** Re-fetches quotation from Marketing: never trust client-provided branch or status claims. */
export async function validateMarketingQuotation(req: Request, id: string, branch: string): Promise<MarketingQuotation> {
  const result = await gatewayGet(`marketing/quotation-references/${id}`, req);
  const parsed = marketingQuotationSchema.safeParse(result);
  if (!parsed.success) throw new HttpError('Invalid quotation response', 502);
  const quotation = parsed.data;
  if (quotation.id !== id || quotation.officeBranchId !== branch) throw new HttpError('Quotation not found in this branch', 404);
  if (!quotation.isActive || quotation.status !== 'APPROVED') throw new HttpError('Quotation must be active and APPROVED', 409);
  return quotation;
}
export async function loadQuotation(req: Request, id: string, version: number, branch: string): Promise<QuotationSnapshot> {
  const parsed = quotationSchema.safeParse(await gatewayGet(`marketing/quotation-references/${id}`, req));
  if (!parsed.success) throw new HttpError('Invalid quotation response', 502);
  const quotation = parsed.data;
  if (quotation.id !== id || quotation.officeBranchId !== branch) throw new HttpError('Quotation not found', 404);
  if (quotation.version !== version) throw new HttpError('Quotation has changed; reload before creating the document', 409);
  return quotation;
}
// The live Work Order that backs a quotation, as reported by Field Service.
// Only the tax rate of the stored quotation snapshot is read; the snapshot holds
// no price, so nothing billable is taken from it.
export const workOrderReferenceSchema = z.object({
  id: z.string().uuid(), quotationId: z.string().uuid(), officeBranchId: z.string().uuid(),
  revoked: z.boolean(), number: z.string(), status: z.enum(['DRAFT', 'IN_PROGRESS', 'COMPLETED']),
  version: z.number().int().nonnegative(),
  quotationSnapshot: z.object({ tax: money }).passthrough().nullable().optional(),
}).passthrough();
export type WorkOrderReference = z.infer<typeof workOrderReferenceSchema>;
/**
 * Reads the active Work Order of a quotation from Field Service. Returns null
 * when the quotation has no live Work Order. The call carries the end user token,
 * so Field Service derives the branch itself and the branch is verified here
 * against the caller's branch before the reference is used.
 */
export async function loadWorkOrderForQuotation(req: Request, quotationId: string, branch: string): Promise<WorkOrderReference | null> {
  const result = await gatewayGet(`fieldservice/work-orders/by-quotation/${quotationId}`, req);
  if (!result) return null;
  const parsed = workOrderReferenceSchema.safeParse(result);
  if (!parsed.success) throw new HttpError('Invalid Work Order response', 502);
  const workOrder = parsed.data;
  if (workOrder.quotationId !== quotationId || workOrder.officeBranchId !== branch) throw new HttpError('Work Order does not belong to this quotation and branch', 502);
  return workOrder;
}

export const billingPricesResponseSchema = z.object({
  officeBranchId: z.string().uuid(),
  company: z.object({ id: z.string().uuid(), name: z.string(), isSisterCompany: z.boolean() }),
  items: z.array(z.object({
    itemSizeId: z.string().uuid(), priceInspection: money, priceMaintenance: money.nullable(),
    priceSource: z.enum(['PRIMARY', 'SISTER_COMPANY', 'CONTRACT']), priceId: z.string().uuid(), priceVersion: z.number().int(),
    catalogSnapshot: z.object({ serviceName: z.string(), serviceType: z.string(), itemName: z.string(), size: z.string().nullable(), hasMaintenance: z.boolean() }),
  }).passthrough()).min(1).max(100),
});
export type BillingPrices = z.infer<typeof billingPricesResponseSchema>;
export async function loadBillingPrices(req: Request, companyId: string, itemSizeIds: string[], branch: string): Promise<BillingPrices> {
  const result = billingPricesResponseSchema.safeParse(await gatewayGet('marketing/billing-price-references', req, { companyId, itemSizeIds }));
  if (!result.success) throw new HttpError('Invalid billing prices response', 502);
  const data = result.data;
  if (data.officeBranchId !== branch || data.company.id !== companyId || data.items.length !== itemSizeIds.length
      || new Set(data.items.map(item => item.itemSizeId)).size !== itemSizeIds.length
      || data.items.some(item => !itemSizeIds.includes(item.itemSizeId))) throw new HttpError('Billing prices reference mismatch', 502);
  return data;
}
