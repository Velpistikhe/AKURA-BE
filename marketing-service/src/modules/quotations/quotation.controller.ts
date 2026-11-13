import { Request, Response } from 'express';
import { quotationApproval } from './quotation-approval.service.js';
import { quotationRepository } from './quotation.repository.js';
import { ListQuotationsInput } from './quotation.schemas.js';
import { getAuditActor, getOfficeBranchId, restrictListVisibility } from '../../utils/officeBranch.js';
import { HttpError } from '../../utils/httpError.js';

const send = (req: Request, res: Response, status: number, message: string, data: unknown): void => {
  res.status(status).json({ status, success: true, message, data, requestId: req.headers['x-request-id'] });
};

export const quotationController = {
  async preview(_req: Request, res: Response) {
    const branch = getOfficeBranchId(res);
    const { pdf, fileName } = await quotationApproval.preview(res.locals.params.quotationId, branch, getAuditActor(res));
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
    // The mirrored Work Order reference is authoritative. Field Service writes it
    // in the same transaction that creates the Work Order, so the quotation row
    // and the Work Order cannot disagree about a live link.
    if (quote.hasWorkOrder || quote.workOrderId) {
      throw new HttpError('A quotation with an active Work Order cannot be revised until the Work Order is revoked', 409);
    }
    send(req, res, 201, 'Quotation revised successfully', await quotationRepository.revise(quotationId, res.locals.body.version, branch, getAuditActor(res)));
  },
  async approve(req: Request, res: Response) {

    const branch = getOfficeBranchId(res);
    send(req, res, 200, 'Quotation approved and PDF generated successfully', await quotationApproval.approve(res.locals.params.quotationId, res.locals.body, branch, getAuditActor(res)));
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
    const branch = getOfficeBranchId(res);
    const quotationId = res.locals.params.quotationId;
    const quote = await quotationRepository.findActive(quotationId, branch);
    if (quote.hasWorkOrder || quote.workOrderId) {
      throw new HttpError('A quotation with an active Work Order cannot be deleted until the Work Order is revoked', 409);
    }
    send(req, res, 200, 'Quotation deleted successfully', await quotationRepository.deactivate(quotationId, res.locals.body, branch, getAuditActor(res)));
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
