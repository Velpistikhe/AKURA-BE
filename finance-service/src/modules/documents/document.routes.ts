import { Router, Request, Response } from 'express';
import { DocumentKind } from '@prisma/client';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Actor, requireActor, requireMarketingForwardedActor } from '../../middlewares/actor.middleware.js';
import { loadQuotation, validateMarketingQuotation } from '../../integrations/gateway.js';
import { HttpError } from '../../utils/httpError.js';
import { documentRepository as repository } from './document.repository.js';
import { createProformaSchema, createInvoiceSchema, createFromMarketingSchema, approveSchema, updateProformaSchema, updateInvoiceSchema, deleteSchema, listSchema, historySchema, idSchema } from './document.schemas.js';
const actor = (res: Response): Actor => res.locals.documentActor;
const send = (req: Request, res: Response, data: unknown, status = 200) => { res.status(status).json({status,success:true,message:'Request completed successfully',data,requestId:req.headers['x-request-id']}); };
/**
 * Canonical projection of the billed quotation lines. Only the fields that end up
 * on the invoice are compared, so Marketing-internal bookkeeping on a line can
 * never make an otherwise identical request look different.
 */
const billedLines = (items: readonly { id: string; itemSizeId: string; quantityInspection: string; quantityMaintenance: string; priceInspection: string; priceMaintenance: string | null; discount: string; subTotal: string }[]): string =>
  JSON.stringify(items.map(item => [item.id, item.itemSizeId, item.quantityInspection, item.quantityMaintenance, item.priceInspection, item.priceMaintenance, item.discount, item.subTotal]));
export function documentRoutes(kind: DocumentKind) {
  const createInput = kind === 'INVOICE' ? createInvoiceSchema : createProformaSchema;
  const updateInput = kind === 'INVOICE' ? updateInvoiceSchema : updateProformaSchema;
  const router = Router();
  // Marketing users are allowed to reach only this forwarded creation endpoint.
  router.post('/from-marketing', requireMarketingForwardedActor, asyncHandler(async (req, res) => {
    const input = createFromMarketingSchema.parse(req.body);
    if (input.quotation.officeBranchId !== actor(res).officeBranchId) throw new HttpError('Quotation not found in this branch', 404);
    const quotation = await validateMarketingQuotation(req, input.quotation.id, actor(res).officeBranchId);
    if (quotation.version !== input.quotation.version) throw new HttpError('Quotation has changed; retry from Marketing', 409);
    if (billedLines(quotation.items) !== billedLines(input.quotation.items)) throw new HttpError('Quotation items do not match Marketing data', 409);
    send(req, res, await repository.createFromMarketing(kind, quotation, input.dueDate ?? null, input.notes, actor(res)), 201);
  }));
  router.use(requireActor);
  router.post('/:id/approve',asyncHandler(async(req,res)=>{
    const version=approveSchema.parse(req.body).version;
    const data=await repository.approve(kind,idSchema.parse(req.params.id),version,actor(res)); send(req,res,data);
  }));
  router.get('/',asyncHandler(async (req,res) => send(req,res,await repository.list(kind,listSchema.parse(req.query),actor(res)))));
  router.get('/:id/history',asyncHandler(async (req,res) => { const {page,limit}=historySchema.parse(req.query); send(req,res,await repository.history(kind,idSchema.parse(req.params.id),actor(res),page,limit)); }));
  router.get('/:id',asyncHandler(async (req,res) => send(req,res,await repository.get(kind,idSchema.parse(req.params.id),actor(res)))));
  router.post('/',asyncHandler(async (req,res) => {
    const input = createInput.parse(req.body);
    const quotation = await loadQuotation(req,input.quotationId,input.quotationVersion,actor(res).officeBranchId);
    send(req,res,await repository.create(kind,input,quotation,actor(res)),201);
  }));
  router.patch('/:id',asyncHandler(async (req,res) => send(req,res,await repository.mutate(kind,idSchema.parse(req.params.id),updateInput.parse(req.body),actor(res)))));
  router.delete('/:id',asyncHandler(async (req,res) => send(req,res,await repository.mutate(kind,idSchema.parse(req.params.id),deleteSchema.parse(req.body),actor(res),true))));
  return router;
}
