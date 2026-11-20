import { Router, Request, Response } from 'express';
import { Actor, requireActor, requireMarketingUser, requireWorkOrderSection } from '../../middlewares/actor.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { HttpError } from '../../utils/httpError.js';
import { loadCompany, loadContract, loadItemSizeReference, loadQuotationForBasis, loadQuotationForStart } from '../../integrations/gateway.js';
import { WorkOrderWriteResult, workOrderRepository as repository } from './work-order.repository.js';
import { syncWorkOrderMirrorToMarketing } from './work-order-marketing-mirror.js';
import { createWorkOrderByCompanySchema, startWorkOrderSchema, updateWorkOrderSchema, deleteWorkOrderSchema, listWorkOrderSchema, workOrderIdSchema, workOrderHistorySchema } from './work-order.schemas.js';

type BasisInput = { quotationId?: string | null; contractId?: string | null };
const resolveBasis = async (req: Request, body: BasisInput, branch: string) => {
  if (body.quotationId) return loadQuotationForBasis(req, body.quotationId, branch);
  if (body.contractId) return loadContract(req, body.contractId, branch);
  return null;
};
const router = Router();
const actor = (res: Response): Actor => res.locals.workOrderActor;
const send = (req: Request, res: Response, data: unknown, status = 200) =>
  res.status(status).json({ status, success: true, message: 'Request completed successfully', data, requestId: req.headers['x-request-id'] });

const requestId = (req: Request): string | undefined => {
  const value = req.headers['x-request-id'];
  return typeof value === 'string' ? value : undefined;
};

const sendQuotationWrite = async (
  req: Request,
  res: Response,
  branchId: string,
  result: WorkOrderWriteResult,
  options: { quotationId: string | null; mirrorOnStatusChange?: boolean; revoked?: boolean },
  status = 200,
) => {
  if (result.row.quotationId && options.quotationId) {
    const shouldMirror = options.revoked === true
      || options.mirrorOnStatusChange === true
      || result.row.status !== 'DRAFT';
    if (shouldMirror) {
      await syncWorkOrderMirrorToMarketing(result.row, options.quotationId, branchId, {
        revoked: options.revoked === true,
        requestId: requestId(req),
      });
    }
  }
  send(req, res, result.row, status);
};

router.use(requireActor);
router.get('/', asyncHandler(async (req, res) => { send(req, res, await repository.list(listWorkOrderSchema.parse(req.query), actor(res))); }));
router.get('/:id/history', asyncHandler(async (req, res) => {
  const { page, limit } = workOrderHistorySchema.parse(req.query);
  send(req, res, await repository.history(workOrderIdSchema.parse(req.params.id), page, limit, actor(res)));
}));
router.get('/:id', asyncHandler(async (req, res) => { send(req, res, await repository.get(workOrderIdSchema.parse(req.params.id), actor(res))); }));
router.post('/', requireMarketingUser, asyncHandler(async (req, res) => {
  const input = createWorkOrderByCompanySchema.parse(req.body);
  const branch = actor(res).officeBranchId;
  const company = await loadCompany(req, input.companyId, branch);
  const contract = input.contractId ? await loadContract(req, input.contractId, branch) : null;
  const itemSnapshots = await Promise.all(input.items.map(async item => ({ ...item, snapshot: await loadItemSizeReference(req, item.itemSizeId) })));
  send(req, res, await repository.createByCompany(input, company, actor(res), contract, itemSnapshots), 201);
}));
router.post('/:id/start', requireWorkOrderSection('MARKETING'), asyncHandler(async (req, res) => {
  const id = workOrderIdSchema.parse(req.params.id);
  const { version } = startWorkOrderSchema.parse(req.body);
  const current = await repository.get(id, actor(res));
  if (current.version !== version || current.status !== 'DRAFT' || current.revoked) {
    throw new HttpError('Work order has changed or is not a draft; reload before retrying', 409);
  }
  const quote = current.quotationId ? await loadQuotationForStart(req, current.quotationId, actor(res).officeBranchId) : null;
  const branchId = actor(res).officeBranchId;
  await sendQuotationWrite(req, res, branchId, await repository.start(id, version, quote, actor(res)), {
    quotationId: current.quotationId,
    mirrorOnStatusChange: true,
  });
}));
router.patch('/:id', requireMarketingUser, asyncHandler(async (req, res) => {
  const id = workOrderIdSchema.parse(req.params.id);
  const input = updateWorkOrderSchema.parse(req.body);
  const quotation = (input.quotationId !== undefined || input.contractId !== undefined)
    ? await resolveBasis(req, input, actor(res).officeBranchId) : null;
  const before = await repository.get(id, actor(res));
  const branchId = actor(res).officeBranchId;
  const result = await repository.update(id, input, quotation, actor(res));
  await sendQuotationWrite(req, res, branchId, result, {
    quotationId: result.row.quotationId ?? before.quotationId ?? null,
    mirrorOnStatusChange: Boolean(before.quotationId && result.row.status !== before.status),
  });
}));
router.delete('/:id', requireWorkOrderSection('MARKETING'), asyncHandler(async (req, res) => {
  const id = workOrderIdSchema.parse(req.params.id);
  const { version } = deleteWorkOrderSchema.parse(req.body);
  const before = await repository.get(id, actor(res));
  const branchId = actor(res).officeBranchId;
  await sendQuotationWrite(req, res, branchId, await repository.revoke(id, version, actor(res)), {
    quotationId: before.quotationId ?? null,
    revoked: true,
  });
}));
export default router;