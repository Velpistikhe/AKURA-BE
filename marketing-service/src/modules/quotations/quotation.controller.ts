import { Request, Response } from 'express';
import { quotationApproval } from './quotation-approval.service.js';
import { quotationRepository } from './quotation.repository.js';
import { ListQuotationsInput, createWorkOrderFromQuotationSchema } from './quotation.schemas.js';
import { MarketingContact } from '../../types/auth.types.js';
import { getAuditActor, getOfficeBranchId, restrictListVisibility } from '../../utils/officeBranch.js';
import { getAccessToken } from '../../utils/requestTokens.js';
import { serviceHeaders, serviceUrl } from '../../utils/serviceUrl.js';
import { HttpError } from '../../utils/httpError.js';
import { loadMarketingContacts } from '../user-sync/marketing-contact.repository.js';
import { hasActiveWorkOrder, notifyFieldServiceWorkOrderRevoked } from './work-order.integration.js';

const send = (req: Request, res: Response, status: number, message: string, data: unknown): void => {
  res.status(status).json({ status, success: true, message, data, requestId: req.headers['x-request-id'] });
};
const CONTACTS_PATH = 'auth/users/marketing-contacts';

export interface QuotationContactDependencies {
  branch: string;
  accessToken?: string;
  loadLocal?: (branch: string) => Promise<MarketingContact[]>;
  fetchImpl?: typeof fetch;
}

const loadLocalContacts = async (branch: string): Promise<MarketingContact[]> => {
  try { return await loadMarketingContacts(branch); }
  catch { return []; }
};

const parseContacts = (payload: unknown): MarketingContact[] => {
  const contacts = (payload as { data?: { contacts?: unknown } } | null)?.data?.contacts;
  if (!Array.isArray(contacts)) return [];
  return contacts.flatMap((contact): MarketingContact[] => {
    if (!contact || typeof contact !== 'object') return [];
    const { name, email, telp } = contact as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim()) return [];
    return [{ name: name.trim(), email: typeof email === 'string' ? email : null, telp: typeof telp === 'string' ? telp : null }];
  }).slice(0, 20);
};

/**
 * Local read model first; when it has no rows (for example, before the first
 * user-sync event is delivered), fall back to the legacy Auth directory. Branch
 * always comes from the caller's access token on the Auth side, never from the
 * client. Any failure returns the local result so PDF generation is never blocked.
 */
export const loadQuotationContacts = async ({ branch, accessToken, loadLocal = loadLocalContacts, fetchImpl = fetch }: QuotationContactDependencies): Promise<MarketingContact[]> => {
  const local = await loadLocal(branch);
  if (local.length || !accessToken) return local;
  try {
    const response = await fetchImpl(serviceUrl(CONTACTS_PATH), {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { authorization: `Bearer ${accessToken}`, ...serviceHeaders(CONTACTS_PATH) },
    });
    if (!response.ok) return local;
    return parseContacts(await response.json());
  } catch { return local; }
};

/** Convenience wrapper for HTTP controllers: resolves branch + token from the request. */
export const loadContactsFromRequest = (req: Request, branch: string): Promise<MarketingContact[]> =>
  loadQuotationContacts({ branch, accessToken: getAccessToken(req) });

export const quotationController = {
  async preview(req: Request, res: Response) {
    const branch = getOfficeBranchId(res);
    const contacts = await loadContactsFromRequest(req, branch);
    const { pdf, fileName } = await quotationApproval.preview(res.locals.params.quotationId, branch, getAuditActor(res), contacts);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).send(pdf);
  },
  async submit(req: Request, res: Response) {
    send(req, res, 200, 'Quotation submitted successfully', await quotationRepository.submit(res.locals.params.quotationId, res.locals.body.version, getOfficeBranchId(res), getAuditActor(res)));
  },
  async reject(req: Request, res: Response) {
    send(req, res, 200, 'Quotation rejected successfully', await quotationRepository.reject(res.locals.params.quotationId, res.locals.body.version, getOfficeBranchId(res), getAuditActor(res)));
  },
  async revise(req: Request, res: Response) {
    const branch = getOfficeBranchId(res);
    const quotationId = res.locals.params.quotationId;
    const quote = await quotationRepository.findActive(quotationId, branch);
    // Local flag is checked first for a fast 409 without a network call. The
    // live Field Service lookup is authoritative: it also rejects when Marketing
    // is unreachable (fail-closed) and when a Work Order was created but this
    // quotation row has not yet recorded the link.
    if (quote.hasWorkOrder || await hasActiveWorkOrder(req, quotationId, branch)) {
      throw new HttpError('A quotation with an active Work Order cannot be revised until the Work Order is revoked', 409);
    }
    send(req, res, 201, 'Quotation revised successfully', await quotationRepository.revise(quotationId, res.locals.body.version, branch, getAuditActor(res)));
  },
  async approve(req: Request, res: Response) {

    const branch = getOfficeBranchId(res);
    const contacts = await loadContactsFromRequest(req, branch);
    send(req, res, 200, 'Quotation approved and PDF generated successfully', await quotationApproval.approve(res.locals.params.quotationId, res.locals.body, branch, getAuditActor(res), contacts));
  },
  async list(req: Request, res: Response) {
    send(req, res, 200, 'Quotations retrieved successfully', await quotationRepository.list(restrictListVisibility(res, res.locals.query as ListQuotationsInput), getOfficeBranchId(res)));
  },
  async get(req: Request, res: Response) {
    send(req, res, 200, 'Quotation retrieved successfully', await quotationApproval.get(res.locals.params.quotationId, getOfficeBranchId(res)));
  },
  async getReference(req: Request, res: Response) {
    send(req, res, 200, 'Quotation retrieved successfully', await quotationRepository.findActive(res.locals.params.quotationId, getOfficeBranchId(res)));
  },
  /** Branch-scoped list of APPROVED quotations as downstream document bases. */
  async listReference(req: Request, res: Response) {
    send(req, res, 200, 'Quotation references retrieved successfully', await quotationRepository.listReference(getOfficeBranchId(res)));
  },
  async create(req: Request, res: Response) {
    // Validation middleware already checked the request. The repository also parses
    // raw input for non-HTTP callers, including converting date strings to Date.
    send(req, res, 201, 'Quotation created successfully', await quotationRepository.create(req.body, getOfficeBranchId(res), getAuditActor(res)));
  },
  /**
   * Creates a DRAFT Work Order in Field Service for an APPROVED quotation. The
   * quotation is loaded locally to fail fast (404/409) before the cross-service
   * call, and the same access token is forwarded so Field Service re-validates
   * identity, branch and section. The payload carries quotationId with startDate,
   * endDate and inspectors as an array of { userId, name } pairs; Field Service`r`n    * re-validates every pair against its FieldServiceUser snapshot and stores the`r`n    * confirmed userId and name. Quotation content is read from the snapshot that was
   * synchronized at approval, so no quotation version is forwarded.
   */
  async createWorkOrder(req: Request, res: Response) {
    const input = createWorkOrderFromQuotationSchema.parse(req.body);
    const branch = getOfficeBranchId(res);
    if (input.quotationId !== res.locals.params.quotationId) throw new HttpError('quotationId must match the quotation in the URL', 400);
    const quote = await quotationRepository.findActive(input.quotationId, branch);
    if (quote.status !== 'APPROVED') throw new HttpError('Work order requires an APPROVED quotation', 409);
    if (quote.items.some(item => item.priceSelection && typeof item.priceSelection === 'object'
      && (item.priceSelection as Record<string, unknown>).priceSource === 'CONTRACT')) {
      throw new HttpError('Use contract as the work order basis for contract pricing', 409);
    }
    const token = getAccessToken(req);
    if (!token) throw new HttpError('Access token is required', 401);
    const path = 'fieldservice/work-orders';
    let response: globalThis.Response;
    try {
      response = await fetch(serviceUrl(path), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...serviceHeaders(path),
          ...(typeof req.headers['x-request-id'] === 'string' ? { 'x-request-id': req.headers['x-request-id'] } : {}) },
        body: JSON.stringify({
          quotationId: quote.id,
          startDate: input.startDate, endDate: input.endDate,
          inspectors: input.inspectors,
        }),
      });
    } catch { throw new HttpError('Field Service is unavailable; retry later', 503); }
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { message?: string } | null;
      const status = [400, 401, 403, 404, 409].includes(response.status) ? response.status : 502;
      throw new HttpError(body?.message || 'Unable to create the Work order in Field Service', status);
    }
    try {
      const workOrder = (await response.json() as { data: { id: string; number: string; status: string; quotationId: string | null; officeBranchId: string; revoked: boolean; version: number } }).data;
      if (!workOrder?.id || workOrder.quotationId !== quote.id || workOrder.officeBranchId !== branch || workOrder.revoked !== false
        || !Number.isInteger(workOrder.version)) {
        throw new HttpError('Invalid response from Field Service', 502);
      }
      try {
        await quotationRepository.attachWorkOrder(quote.id, branch, workOrder, getAuditActor(res));
      } catch (error) {
        // Marketing could not store the link, so the Work Order must not stay
        // live: revoke it in Field Service before reporting the failure.
        await notifyFieldServiceWorkOrderRevoked(workOrder.id, workOrder.version, req).catch(() => undefined);
        throw error;
      }
      send(req, res, 201, 'Work order created successfully', workOrder);
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError('Invalid response from Field Service', 502);
    }
  },
  async delete(req: Request, res: Response) {
    send(req, res, 200, 'Quotation deleted successfully', await quotationRepository.deactivate(res.locals.params.quotationId, res.locals.body, getOfficeBranchId(res), getAuditActor(res)));
  },
  async update(req: Request, res: Response) {
    send(req, res, 200, 'Quotation updated successfully', await quotationRepository.update(res.locals.params.quotationId, res.locals.body, getOfficeBranchId(res), getAuditActor(res)));
  },
  async addItem(req: Request, res: Response) {
    send(req, res, 201, 'Quotation item added successfully', await quotationRepository.addItem(res.locals.params.quotationId, res.locals.body, getOfficeBranchId(res), getAuditActor(res)));
  },
  async deleteItem(req: Request, res: Response) {
    send(req, res, 200, 'Quotation item deleted successfully', await quotationRepository.deleteItem(res.locals.params.quotationId, res.locals.params.itemId, res.locals.body, getOfficeBranchId(res), getAuditActor(res)));
  },

};
