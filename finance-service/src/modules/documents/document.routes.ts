import { Router, Request, Response } from 'express';
import { DocumentKind, Prisma } from '@prisma/client';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Actor, requireActor, requireMarketingForwardedActor } from '../../middlewares/actor.middleware.js';
import { loadWorkOrderForQuotation, validateMarketingQuotation, loadBillingPrices } from '../../integrations/gateway.js';
import { HttpError } from '../../utils/httpError.js';
import { documentRepository as repository } from './document.repository.js';
import { documentCreateSchema, createFromMarketingSchema, approveSchema, updateProformaSchema, updateInvoiceSchema, deleteSchema, listSchema, historySchema, idSchema } from './document.schemas.js';
const actor = (res: Response): Actor => res.locals.documentActor;
const send = (req: Request, res: Response, data: unknown, status = 200) => { res.status(status).json({status,success:true,message:'Request completed successfully',data,requestId:req.headers['x-request-id']}); };
/**
 * Canonical projection of the billed quotation lines. Only the fields that end up
 * on the invoice are compared, so Marketing-internal bookkeeping on a line can
 * never make an otherwise identical request look different.
 */
const billedLines = (items: readonly Record<string, unknown>[]): string => JSON.stringify(items.map(item =>
  ['id', 'position', 'itemSizeId', 'serviceName', 'serviceType', 'itemName', 'size', 'note', 'quantityInspection', 'quantityMaintenance', 'priceInspection', 'priceMaintenance', 'discount', 'subTotal']
    .map(key => ['quantityInspection', 'quantityMaintenance', 'priceInspection', 'priceMaintenance', 'discount', 'subTotal'].includes(key) && item[key] !== null
      ? new Prisma.Decimal(String(item[key])).toString() : item[key])));
export function documentRoutes(kind: DocumentKind) {
  const updateInput = kind === 'INVOICE' ? updateInvoiceSchema : updateProformaSchema;
  const router = Router();
  const createDocument = (alias = false) => asyncHandler(async (req, res) => {
    const input = alias ? { ...createFromMarketingSchema.parse(req.body), source: 'QUOTATION' as const } : documentCreateSchema.parse(req.body);
    if (input.source === 'DIRECT') {
      if (!res.locals.financeAccessAllowed) throw new HttpError('Finance or Accounting access is required', 403);
      const prices = await loadBillingPrices(req, input.companyId, input.items.map(item => item.itemSizeId), actor(res).officeBranchId);
      send(req, res, await repository.createDirect(kind, input, prices, actor(res)), 201);
      return;
    }
    if (input.quotation.officeBranchId !== actor(res).officeBranchId) throw new HttpError('Quotation not found in this branch', 404);
    const quotation = await validateMarketingQuotation(req, input.quotation.id, actor(res).officeBranchId);
    if (quotation.version !== input.quotation.version) throw new HttpError('Quotation has changed; retry from Marketing', 409);
    if (billedLines(quotation.items) !== billedLines(input.quotation.items)
      || quotation.subject !== input.quotation.subject
      || ['tax', 'subTotal', 'taxAmount', 'total'].some(key => !new Prisma.Decimal(String(quotation[key])).equals(String(input.quotation[key]))))
      throw new HttpError('Quotation items or totals do not match Marketing data', 409);
    const workOrder = await loadWorkOrderForQuotation(req, quotation.id, actor(res).officeBranchId);
    send(req, res, await repository.createFromMarketing(kind, quotation, input.dueDate, input.notes, actor(res), workOrder), 201);
  });
  router.post('/from-marketing', requireMarketingForwardedActor, createDocument(true));
  router.post('/', requireMarketingForwardedActor, createDocument());
  router.use(requireActor);
  router.post('/:id/approve',asyncHandler(async(req,res)=>{
    const version=approveSchema.parse(req.body).version;
    const data=await repository.approve(kind,idSchema.parse(req.params.id),version,actor(res)); send(req,res,data);
  }));
  router.get('/',asyncHandler(async (req,res) => send(req,res,await repository.list(kind,listSchema.parse(req.query),actor(res)))));
  router.get('/:id/history',asyncHandler(async (req,res) => { const {page,limit}=historySchema.parse(req.query); send(req,res,await repository.history(kind,idSchema.parse(req.params.id),actor(res),page,limit)); }));
  router.get('/:id',asyncHandler(async (req,res) => send(req,res,await repository.get(kind,idSchema.parse(req.params.id),actor(res)))));
  router.patch('/:id',asyncHandler(async (req,res) => send(req,res,await repository.mutate(kind,idSchema.parse(req.params.id),updateInput.parse(req.body),actor(res)))));
  router.delete('/:id',asyncHandler(async (req,res) => send(req,res,await repository.mutate(kind,idSchema.parse(req.params.id),deleteSchema.parse(req.body),actor(res),true))));
  return router;
}
