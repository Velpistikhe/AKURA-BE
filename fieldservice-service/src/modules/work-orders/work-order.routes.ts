import { Router, Request, Response } from 'express';
import { Actor, requireActor, requireMarketingUser, requireWorkOrderSection } from '../../middlewares/actor.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { HttpError } from '../../utils/httpError.js';
import { loadCompany, loadContract, loadItemSizeReference, loadQuotationForBasis, loadQuotationForStart, notifyMarketingWorkOrderStatus } from '../../integrations/gateway.js';
import { workOrderRepository as repository } from './work-order.repository.js';
import { createWorkOrderByCompanySchema, createWorkOrderByQuotationSchema, startWorkOrderSchema, updateWorkOrderSchema, deleteWorkOrderSchema, listWorkOrderSchema, workOrderIdSchema, workOrderHistorySchema } from './work-order.schemas.js';
type BasisInput = { quotationId?: string | null; contractId?: string | null };
// The payload carries IDs only. Quotation and contract content is fetched live from
// Marketing and validated (branch, APPROVED state, contract effective period) before
// being reduced to the stored snapshot.
const resolveBasis = async (req: Request, body: BasisInput, branch: string) => {
  if (body.quotationId) return loadQuotationForBasis(req, body.quotationId, branch);
  if (body.contractId) return loadContract(req, body.contractId, branch);
  return null;
};
const router = Router();
const actor = (res: Response): Actor => res.locals.workOrderActor;
const send = (req: Request, res: Response, data: unknown, status = 200) => res.status(status).json({ status, success: true, message: 'Request completed successfully', data, requestId: req.headers['x-request-id'] });
router.use(requireActor);
router.get('/', asyncHandler(async (req, res) => { send(req, res, await repository.list(listWorkOrderSchema.parse(req.query), actor(res))); }));
router.get('/:id/history', asyncHandler(async (req, res) => {
  const { page, limit } = workOrderHistorySchema.parse(req.query);
  send(req, res, await repository.history(workOrderIdSchema.parse(req.params.id), page, limit, actor(res)));
}));
router.get('/:id', asyncHandler(async (req, res) => { send(req, res, await repository.get(workOrderIdSchema.parse(req.params.id), actor(res))); }));
// Company basis: the Work Order is not derived from a Marketing quotation. The
// company is validated live against Marketing, so an unknown, revoked or
// other-branch company is rejected before anything is stored.
router.post('/', requireMarketingUser, asyncHandler(async (req, res) => {
  const input = createWorkOrderByCompanySchema.parse(req.body);
  const branch = actor(res).officeBranchId;
  const company = await loadCompany(req, input.companyId, branch);
  const contract = input.contractId ? await loadContract(req, input.contractId, branch) : null;
  const itemSnapshots = await Promise.all(input.items.map(async item => ({ ...item, snapshot: await loadItemSizeReference(req, item.itemSizeId) })));
  send(req, res, await repository.createByCompany(input, company, actor(res), contract, itemSnapshots), 201);
}));
// Quotation basis: the Work Order is derived from an approved Marketing
// quotation. The company is never taken from the client; it is read from the
// quotation company snapshot returned by Marketing.
router.post('/from-quotation', requireMarketingUser, asyncHandler(async (req, res) => {
  const input = createWorkOrderByQuotationSchema.parse(req.body);
  const quotation = await loadQuotationForBasis(req, input.quotationId, actor(res).officeBranchId);
  // Marketing records the quotation link inside the same transaction that
  // creates the Work Order, so a failed callback rolls the Work Order back.
  send(req, res, await repository.createByQuotation(input, quotation, actor(res), row => notifyMarketingWorkOrderStatus(row, req)), 201);
}));
router.post('/:id/start', requireWorkOrderSection('MARKETING'), asyncHandler(async (req, res) => {
  const id = workOrderIdSchema.parse(req.params.id);
  const { version } = startWorkOrderSchema.parse(req.body);
  // The stored row is read first so a non-draft fails fast and the upstream
  // calls are only made for a draft in this branch; the upstream requests never
  // run inside a database transaction.
  const current = await repository.get(id, actor(res));
  if (current.version !== version || current.status !== 'DRAFT' || current.revoked) throw new HttpError('Work order has changed or is not a draft; reload before retrying', 409);
  const quote = current.quotationId ? await loadQuotationForStart(req, current.quotationId, actor(res).officeBranchId) : null;
  send(req, res, await repository.start(id, version, quote, actor(res), row => notifyMarketingWorkOrderStatus(row, req)));
}));
router.patch('/:id', requireMarketingUser, asyncHandler(async (req, res) => {
  const id = workOrderIdSchema.parse(req.params.id), input = updateWorkOrderSchema.parse(req.body);
  const quotation = (input.quotationId !== undefined || input.contractId !== undefined)
    ? await resolveBasis(req, input, actor(res).officeBranchId) : null;
  send(req, res, await repository.update(id, input, quotation, actor(res), row => notifyMarketingWorkOrderStatus(row, req)));
}));
router.delete('/:id', requireWorkOrderSection('MARKETING'), asyncHandler(async (req, res) => {
  const { version } = deleteWorkOrderSchema.parse(req.body);
  send(req, res, await repository.revoke(workOrderIdSchema.parse(req.params.id), version, actor(res), row => notifyMarketingWorkOrderStatus({ ...row, revoked: true }, req)));
}));
export default router;
