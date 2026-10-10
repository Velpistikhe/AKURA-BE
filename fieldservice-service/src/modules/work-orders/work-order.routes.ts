import { Router, Request, Response } from 'express';
import { Actor, requireActor, requireWorkOrderSection } from '../../middlewares/actor.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { HttpError } from '../../utils/httpError.js';
import { loadCompanyContract, loadContract, loadQuotationForStart } from '../../integrations/gateway.js';
import { loadStoredQuotation } from '../quotation-snapshots/quotation-snapshot.repository.js';
import { workOrderRepository as repository } from './work-order.repository.js';
import { createWorkOrderSchema, startWorkOrderSchema, updateWorkOrderSchema, deleteWorkOrderSchema, listWorkOrderSchema, workOrderIdSchema, workOrderHistorySchema } from './work-order.schemas.js';
type BasisInput = { quotationId?: string | null; contractId?: string | null; companyId?: string | null };
// Quotation content is already synchronized at approval time; only contracts are
// still validated live through Marketing.
const resolveBasis = async (req: Request, body: BasisInput, branch: string) => {
  if (body.quotationId) return loadStoredQuotation(body.quotationId, branch);
  if (body.contractId) return loadContract(req, body.contractId, branch);
  return loadCompanyContract(req, body.companyId!, branch);
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
router.post('/', requireWorkOrderSection('MARKETING'), asyncHandler(async (req, res) => {
  const input = createWorkOrderSchema.parse(req.body);
  const quotation = await resolveBasis(req, input, actor(res).officeBranchId);
  send(req, res, await repository.create(input, quotation, actor(res)), 201);
}));
router.post('/:id/start', requireWorkOrderSection('MARKETING'), asyncHandler(async (req, res) => {
  const id = workOrderIdSchema.parse(req.params.id);
  const { version } = startWorkOrderSchema.parse(req.body);
  // The stored row is read first so a non-draft fails fast and the Marketing
  // call is only made for a quotation-based draft in this branch; the upstream
  // request never runs inside a database transaction.
  const current = await repository.get(id, actor(res));
  if (current.status !== 'DRAFT' || current.revoked) throw new HttpError('Work order has changed or is not a draft; reload before retrying', 409);
  const quote = current.quotationId ? await loadQuotationForStart(req, current.quotationId, actor(res).officeBranchId) : null;
  send(req, res, await repository.start(id, version, quote, actor(res)));
}));
router.patch('/:id', requireWorkOrderSection('MARKETING', 'FIELD_SERVICE'), asyncHandler(async (req, res) => {
  const id = workOrderIdSchema.parse(req.params.id), input = updateWorkOrderSchema.parse(req.body);
  await repository.get(id, actor(res));
  const quotation = (input.quotationId !== undefined || input.contractId !== undefined || input.companyId !== undefined)
    ? await resolveBasis(req, input, actor(res).officeBranchId) : null;
  send(req, res, await repository.update(id, input, quotation, actor(res)));
}));
router.delete('/:id', requireWorkOrderSection('MARKETING'), asyncHandler(async (req, res) => {
  const { version } = deleteWorkOrderSchema.parse(req.body);
  send(req, res, await repository.revoke(workOrderIdSchema.parse(req.params.id), version, actor(res)));
}));
export default router;
