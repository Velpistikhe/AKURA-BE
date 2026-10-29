import { marketingDocumentReferenceSchema } from './document.schemas.js';
import { Router, Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Actor, requireActor, requireMarketingCreateActor, requireDocumentReadActor } from '../../middlewares/actor.middleware.js';
import { loadWorkOrderForQuotation, validateMarketingQuotation, loadBillingPrices } from '../../integrations/gateway.js';
import { HttpError } from '../../utils/httpError.js';
import { documentRepository as repository } from './document.repository.js';
import { documentCreateSchema, approveSchema, updateSchema, deleteSchema, listSchema, historySchema, idSchema } from './document.schemas.js';
const actor = (res: Response): Actor => res.locals.documentActor;
const send = (req: Request, res: Response, data: unknown, status = 200) => { res.status(status).json({status,success:true,message:'Request completed successfully',data,requestId:req.headers['x-request-id']}); };
// One collection serves both document kinds, so the kind travels in the payload
// and decides the number series: INV for invoices, PI for proforma invoices.
export function documentRoutes() {
  const router = Router();
  const createDocument = () => asyncHandler(async (req, res) => {
    const input = documentCreateSchema.parse(req.body);
    if (!res.locals.financeAccessAllowed) throw new HttpError('Finance, Accounting or Marketing access is required', 403);
    // The payload carries only the item size UUIDs, so the catalog data and the
    // current prices of every line are resolved from Marketing for the company
    // of the document before anything is written.
    const prices = await loadBillingPrices(req, input.companyId, input.items, actor(res).officeBranchId);
    send(req, res, await repository.createFromPurchaseOrder(input.kind, input, prices, actor(res)), 201);
  });
  router.post('/', requireActor, createDocument());
  router.get('/', requireDocumentReadActor, asyncHandler(async (req,res) => send(req,res,await repository.list(listSchema.parse(req.query),actor(res)))));
  router.get('/:id', requireDocumentReadActor, asyncHandler(async (req,res) => send(req,res,await repository.get(idSchema.parse(req.params.id),actor(res)))));
  router.use(requireActor);
  router.post('/:id/approve',asyncHandler(async(req,res)=>{
    const version=approveSchema.parse(req.body).version;
    const data=await repository.approve(idSchema.parse(req.params.id),version,actor(res)); send(req,res,data);
  }));
  router.get('/:id/history',asyncHandler(async(req,res)=> { const {page,limit}=historySchema.parse(req.query); send(req,res,await repository.history(idSchema.parse(req.params.id),actor(res),page,limit)); }));
  router.patch('/:id',asyncHandler(async(req,res)=> send(req,res,await repository.mutate(idSchema.parse(req.params.id),updateSchema.parse(req.body),actor(res)))));
  router.delete('/:id',asyncHandler(async(req,res)=> send(req,res,await repository.mutate(idSchema.parse(req.params.id),deleteSchema.parse(req.body),actor(res),true))));
  return router;
}

export const marketingDocumentRoutes = Router();
marketingDocumentRoutes.post('/from-marketing', requireMarketingCreateActor, asyncHandler(async (req, res) => {
  const input = marketingDocumentReferenceSchema.parse(req.body);
  const quotation = await validateMarketingQuotation(req, input.quotationId, actor(res).officeBranchId);
  const workOrder = await loadWorkOrderForQuotation(req, quotation.id, actor(res).officeBranchId);
  if ((workOrder && workOrder.status !== 'COMPLETED') || (quotation.workOrderStatus && quotation.workOrderStatus !== 'COMPLETED'))
    throw new HttpError('Work Order must be COMPLETED before billing', 409);
  send(req, res, await repository.createFromMarketing(input.kind, quotation, input.dueDate, undefined, actor(res), workOrder, input.location), 201);
}));
