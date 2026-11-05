import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { Actor, requireActor, requireWorkOrderReferenceActor, requireWorkOrderSection } from '../../middlewares/actor.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { HttpError } from '../../utils/httpError.js';
import { loadContract, loadItemSizeReference, loadQuotationForBasis, loadQuotationForStart, notifyMarketingWorkOrderStatus } from '../../integrations/gateway.js';
import { resolveInspectorIdentities, validateInspectorPairs, validateInspectorsForStart } from '../../integrations/auth-directory.js';
import { workOrderRepository as repository } from './work-order.repository.js';
import { createWorkOrderSchema, startWorkOrderSchema, updateWorkOrderSchema, deleteWorkOrderSchema, listWorkOrderSchema, workOrderIdSchema, workOrderHistorySchema } from './work-order.schemas.js';
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
// Read-only reference used by Marketing to check whether a quotation still
// backs a live Work Order before it is revised or deleted. It exposes the
// Work Order identity and status only.
router.get('/by-quotation/:quotationId', requireWorkOrderReferenceActor, asyncHandler(async (req, res) => {
  const quotationId = z.string().uuid().parse(req.params.quotationId);
  send(req, res, await repository.findActiveByQuotation(quotationId, actor(res)));
}));
router.use(requireActor);
router.get('/', asyncHandler(async (req, res) => { send(req, res, await repository.list(listWorkOrderSchema.parse(req.query), actor(res))); }));
router.get('/:id/history', asyncHandler(async (req, res) => {
  const { page, limit } = workOrderHistorySchema.parse(req.query);
  send(req, res, await repository.history(workOrderIdSchema.parse(req.params.id), page, limit, actor(res)));
}));
router.get('/:id', asyncHandler(async (req, res) => { send(req, res, await repository.get(workOrderIdSchema.parse(req.params.id), actor(res))); }));
router.post('/', requireWorkOrderSection('MARKETING'), asyncHandler(async (req, res) => {
  const input = createWorkOrderSchema.parse(req.body);
  const quotation = await resolveBasis(req, input, actor(res).officeBranchId);
  const itemSnapshots = !input.quotationId
    ? await Promise.all(input.items.map(async item => ({ ...item, snapshot: await loadItemSizeReference(req, item.itemSizeId) })))
    : undefined;
  // Auth is the source of truth for FIELD_SERVICE users: every submitted
  // inspector pair is validated against the live Auth directory before the
  // creation transaction starts, so the upstream call never holds locks.
  const inspectorUsers = await validateInspectorPairs(req, input.inspectors);
  send(req, res, await repository.create(input, quotation, actor(res), itemSnapshots, inspectorUsers), 201);
}));
router.post('/:id/start', requireWorkOrderSection('MARKETING'), asyncHandler(async (req, res) => {
  const id = workOrderIdSchema.parse(req.params.id);
  const { version } = startWorkOrderSchema.parse(req.body);
  // The stored row is read first so a non-draft fails fast and the upstream
  // calls are only made for a draft in this branch; the upstream requests never
  // run inside a database transaction.
  const current = await repository.get(id, actor(res));
  if (current.version !== version || current.status !== 'DRAFT' || current.revoked) throw new HttpError('Work order has changed or is not a draft; reload before retrying', 409);
  // Auth is the source of truth for FIELD_SERVICE users: every stored inspector
  // must still exist in Auth with the same id/display name before the transition.
  await validateInspectorsForStart(req, current.inspectors.map(({ userId, name }) => ({ userId, name })));
  const quote = current.quotationId ? await loadQuotationForStart(req, current.quotationId, actor(res).officeBranchId) : null;
  send(req, res, await repository.start(id, version, quote, actor(res), row => notifyMarketingWorkOrderStatus(row, req)));
}));
router.patch('/:id', requireWorkOrderSection('MARKETING'), asyncHandler(async (req, res) => {
  const id = workOrderIdSchema.parse(req.params.id), input = updateWorkOrderSchema.parse(req.body);
  const before = await repository.get(id, actor(res));
  const quotation = (input.quotationId !== undefined || input.contractId !== undefined)
    ? await resolveBasis(req, input, actor(res).officeBranchId) : null;
  // PATCH keeps the name-based contract, so the names are resolved against the
  // live Auth directory before the transaction starts.
  const names = input.inspectors !== undefined
    ? input.inspectors
    : before.inspectors.map((row) => row.name);
  const resolvedInspectors = await resolveInspectorIdentities(req, names);
  send(req, res, await repository.update(id, input, quotation, actor(res), resolvedInspectors, row => notifyMarketingWorkOrderStatus(row, req)));
}));
router.delete('/:id', requireWorkOrderSection('MARKETING'), asyncHandler(async (req, res) => {
  const { version } = deleteWorkOrderSchema.parse(req.body);
  send(req, res, await repository.revoke(workOrderIdSchema.parse(req.params.id), version, actor(res), row => notifyMarketingWorkOrderStatus({ ...row, revoked: true }, req)));
}));
export default router;
