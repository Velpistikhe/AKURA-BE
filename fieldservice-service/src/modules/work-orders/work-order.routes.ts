import { Router, Request, Response } from 'express';
import { Actor, requireActor, requireMarketingUser, requireMarketingUserOrAdmin, requireWorkOrderSection } from '../../middlewares/actor.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { HttpError } from '../../utils/httpError.js';
import { loadCompany, loadContract, loadItemSizeReference, loadQuotationForBasis, loadQuotationForNewWorkOrder, loadQuotationForStart } from '../../integrations/gateway.js';
import { deliverWorkOrderLinkAndWait, wakeWorkOrderLinkDelivery } from './work-order-link-delivery.js';
import { WorkOrderWriteResult, workOrderRepository as repository } from './work-order.repository.js';
import { workOrderSyncRepository } from './work-order-sync.repository.js';
import { workOrderSyncQuerySchema } from './work-order-sync.schemas.js';
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
// Delivers the link event and waits for the acknowledgement, so the response
// never leaves while Marketing still holds the previous link. The write has
// already been committed at this point, so a delivery that cannot be made is
// reported in the log and retried by the worker rather than failing the
// request, which would push the client to submit the same write again.
const flushQuotationLink = async (branchId: string, linkEventId?: string) => {
  if (!linkEventId) return;
  await deliverWorkOrderLinkAndWait(linkEventId, branchId);
  wakeWorkOrderLinkDelivery();
};
const sendWrite = async (req: Request, res: Response, branchId: string, result: WorkOrderWriteResult, status = 200) => {
  await flushQuotationLink(branchId, result.linkEventId);
  send(req, res, result.row, status);
};
router.use(requireActor);
router.get('/', asyncHandler(async (req, res) => { send(req, res, await repository.list(listWorkOrderSchema.parse(req.query), actor(res))); }));
router.get('/:id/history', asyncHandler(async (req, res) => {
  const { page, limit } = workOrderHistorySchema.parse(req.query);
  send(req, res, await repository.history(workOrderIdSchema.parse(req.params.id), page, limit, actor(res)));
}));
// Synchronisation history of one Work Order. Field Service owns the outbox, so
// this reads the recorded Marketing deliveries only. It is a read endpoint, so
// it is open to every section that may read Work Orders. The synchronisation
// records are returned as an array, with the pagination next to it.
router.get('/:id/sync', asyncHandler(async (req, res) => {
  const id = workOrderIdSchema.parse(req.params.id);
  const query = workOrderSyncQuerySchema.parse(req.query);
  const { sync, pagination } = await workOrderSyncRepository.list(id, query, actor(res));
  res.status(200).json({
    status: 200,
    success: true,
    message: 'Work Order synchronisation retrieved successfully',
    data: sync,
    pagination,
    requestId: req.headers['x-request-id'],
  });
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
// quotation company snapshot returned by Marketing. A quotation that already
// backs a Work Order is rejected here, before the write, so the Work Order is
// never created against a quotation that is already in use. The marketing
// admin is admitted next to the marketing officer, so the admin who approves a
// quotation may also turn it into a Work Order.
router.post('/from-quotation', requireMarketingUserOrAdmin, asyncHandler(async (req, res) => {
  const input = createWorkOrderByQuotationSchema.parse(req.body);
  const quotation = await loadQuotationForNewWorkOrder(req, input.quotationId, actor(res).officeBranchId);
  await sendWrite(req, res, actor(res).officeBranchId, await repository.createByQuotation(input, quotation, actor(res)), 201);
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
  await sendWrite(req, res, actor(res).officeBranchId, await repository.start(id, version, quote, actor(res)));
}));
router.patch('/:id', requireMarketingUser, asyncHandler(async (req, res) => {
  const id = workOrderIdSchema.parse(req.params.id), input = updateWorkOrderSchema.parse(req.body);
  const quotation = (input.quotationId !== undefined || input.contractId !== undefined)
    ? await resolveBasis(req, input, actor(res).officeBranchId) : null;
  await sendWrite(req, res, actor(res).officeBranchId, await repository.update(id, input, quotation, actor(res)));
}));
router.delete('/:id', requireWorkOrderSection('MARKETING'), asyncHandler(async (req, res) => {
  const { version } = deleteWorkOrderSchema.parse(req.body);
  await sendWrite(req, res, actor(res).officeBranchId, await repository.revoke(workOrderIdSchema.parse(req.params.id), version, actor(res)));
}));
export default router;
