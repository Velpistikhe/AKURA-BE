import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { HttpError } from '../../utils/httpError.js';
import { parseMarketingQuotationReference, quotationSchema } from '../../integrations/gateway.js';
import { workOrderRepository as repository } from './work-order.repository.js';
import { createWorkOrderByQuotationSchema } from './work-order.schemas.js';

const actorSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1),
}).strict();

const internalCreateSchema = z.object({
  officeBranchId: z.string().uuid(),
  quotationId: z.string().uuid(),
  actor: actorSchema,
  quotation: quotationSchema,
  workOrder: createWorkOrderByQuotationSchema,
}).strict().superRefine((value, ctx) => {
  if (value.quotationId !== value.workOrder.quotationId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'quotationId must match workOrder.quotationId', path: ['workOrder', 'quotationId'] });
  }
  if (value.quotation.id !== value.quotationId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'quotation.id must match quotationId', path: ['quotation', 'id'] });
  }
  if (value.quotation.officeBranchId !== value.officeBranchId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'quotation branch must match officeBranchId', path: ['quotation', 'officeBranchId'] });
  }
});

const router = Router();

const send = (req: Request, res: Response, data: unknown, status = 200) =>
  res.status(status).json({
    status,
    success: true,
    message: 'Request completed successfully',
    data,
    requestId: req.headers['x-request-id'],
  });

router.post('/from-quotation', asyncHandler(async (req, res) => {
  const parsed = internalCreateSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError('Invalid internal work order request', 400);
  const { officeBranchId, quotationId, actor, quotation: quotationPayload, workOrder } = parsed.data;
  const quotation = parseMarketingQuotationReference(quotationPayload, quotationId, officeBranchId);
  if (quotation.hasWorkOrder || quotation.workOrderId) {
    throw new HttpError('Quotation already has a Work Order; revoke it before creating another', 409);
  }
  const row = await repository.createByQuotation(workOrder, quotation, {
    id: actor.id,
    name: actor.name,
    officeBranchId,
  });
  send(req, res, row, 201);
}));

export default router;
