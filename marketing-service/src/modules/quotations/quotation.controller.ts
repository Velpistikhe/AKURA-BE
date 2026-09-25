import { Request, Response } from 'express';
import { quotationApproval } from './quotation-approval.service.js';
import { quotationRepository } from './quotation.repository.js';
import { ListQuotationsInput } from './quotation.schemas.js';
import { MarketingContact } from '../../types/auth.types.js';
import { getAuditActor, getOfficeBranchId, restrictListVisibility } from '../../utils/officeBranch.js';
import { serviceUrl, serviceHeaders } from '../../utils/serviceUrl.js';
import { getAccessToken } from '../../utils/requestTokens.js';
import { logger } from '../../utils/logger.js';

const loadMarketingContacts = async (req: Request): Promise<MarketingContact[]> => {
  const token = getAccessToken(req);
  if (!token) return [];
  try {
    const response = await fetch(serviceUrl('auth/users/marketing-contacts'), {
      headers: { Authorization: `Bearer ${token}`, ...serviceHeaders('auth/users/marketing-contacts'), ...(req.headers['x-request-id'] ? { 'x-request-id': String(req.headers['x-request-id']) } : {}) },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = await response.json() as { data?: { contacts?: MarketingContact[] } };
    return (body.data?.contacts ?? []).filter(contact => contact && typeof contact.name === 'string');
  } catch (error) {
    // Contacts are footer metadata; a directory outage must never block approval or preview.
    logger.warn('Unable to load marketing contacts for quotation PDF', { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
};

const send = (req: Request, res: Response, status: number, message: string, data: unknown): void => {
  res.status(status).json({ status, success: true, message, data, requestId: req.headers['x-request-id'] });
};
export const quotationController = {
  async preview(req: Request, res: Response) {
    const branch = getOfficeBranchId(res);
    const contacts = await loadMarketingContacts(req);
    const { pdf, fileName } = await quotationApproval.preview(res.locals.params.quotationId, branch, getAuditActor(res), contacts);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
    res.setHeader('Content-Length', pdf.length);
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.status(200).send(pdf);
  },
  async approve(req: Request, res: Response) {
    const branch = getOfficeBranchId(res);
    const contacts = await loadMarketingContacts(req);
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
  async create(req: Request, res: Response) {
    // Validation middleware already checked the request. The repository also parses
    // raw input for non-HTTP callers, including converting date strings to Date.
    send(req, res, 201, 'Quotation created successfully', await quotationRepository.create(req.body, getOfficeBranchId(res), getAuditActor(res)));
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
