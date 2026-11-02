import { Request } from 'express';
import { AuthenticatedRequest } from '../types/auth.types.js';
import { serviceUrl, serviceHeaders } from '../utils/serviceUrl.js';
import { getAccessToken } from '../utils/requestTokens.js';
import { HttpError } from '../utils/httpError.js';

// The only remaining upstream call is the authenticated profile read used by the
// actor middleware. Billing document references were removed with the invoice
// and proforma invoice modules.
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
