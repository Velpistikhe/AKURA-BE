import { Router, Request, Response } from 'express';
import { DocumentKind } from '@prisma/client';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { Actor, requireActor } from '../../middlewares/actor.middleware.js';
import { loadQuotation } from '../../integrations/gateway.js';
import { documentRepository as repository } from './document.repository.js';
import { createProformaSchema, createInvoiceSchema, updateProformaSchema, updateInvoiceSchema, deleteSchema, listSchema, historySchema, idSchema } from './document.schemas.js';
const actor = (res: Response): Actor => res.locals.documentActor;
const send = (req: Request, res: Response, data: unknown, status = 200) => { res.status(status).json({status,success:true,message:'Request completed successfully',data,requestId:req.headers['x-request-id']}); };
export function documentRoutes(kind: DocumentKind) {
  const createInput = kind === 'INVOICE' ? createInvoiceSchema : createProformaSchema;
  const updateInput = kind === 'INVOICE' ? updateInvoiceSchema : updateProformaSchema;
  const router = Router();
  router.use(requireActor);
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
