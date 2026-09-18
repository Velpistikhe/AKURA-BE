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
    const status = [401, 403, 404].includes(response.status) ? response.status : 503;
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
export async function loadQuotation(req: Request, id: string, version: number, branch: string): Promise<QuotationSnapshot> {
  const parsed = quotationSchema.safeParse(await gatewayGet(`marketing/quotation-references/${id}`, req));
  if (!parsed.success) throw new HttpError('Invalid quotation response', 502);
  const quotation = parsed.data;
  if (quotation.id !== id || quotation.officeBranchId !== branch) throw new HttpError('Quotation not found', 404);
  if (quotation.version !== version) throw new HttpError('Quotation has changed; reload before creating the document', 409);
  return quotation;
}
