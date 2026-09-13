import { Request, Response } from 'express';
import { quotationApproval } from './quotation-approval.service.js';
import { quotationRepository } from './quotation.repository.js';
import { ListQuotationsInput } from './quotation.schemas.js';
import { getAuditActor, getOfficeBranchId } from '../../utils/officeBranch.js';

const send = (req: Request, res: Response, status: number, message: string, data: unknown): void => {
  res.status(status).json({ status, success: true, message, data, requestId: req.headers['x-request-id'] });
};
export const quotationController = {
  async approve(req: Request, res: Response) {
    send(req, res, 200, 'Quotation approved and PDF generated successfully', await quotationApproval.approve(res.locals.params.quotationId, res.locals.body, getOfficeBranchId(res), getAuditActor(res)));
  },
  async list(req: Request, res: Response) {
    send(req, res, 200, 'Quotations retrieved successfully', await quotationRepository.list(res.locals.query as ListQuotationsInput, getOfficeBranchId(res)));
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
    // Pass validated raw input: the repository parses date strings itself.
    send(req, res, 200, 'Quotation updated successfully', await quotationRepository.update(res.locals.params.quotationId, req.body, getOfficeBranchId(res), getAuditActor(res)));
  },
};
