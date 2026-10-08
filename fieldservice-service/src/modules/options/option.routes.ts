import { Request, Response, Router } from 'express';
import { prisma } from '../../config/db.js';
import { Actor, requireActor } from '../../middlewares/actor.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { listInspectorOptions } from '../user-sync/user-sync.repository.js';

const router = Router();
const actor = (res: Response): Actor => res.locals.workOrderActor;
const send = (req: Request, res: Response, data: unknown) => res.status(200).json({
  status: 200, success: true, message: 'Request completed successfully', data,
  requestId: req.headers['x-request-id'],
});

router.use(requireActor);

/** Branch-scoped active inspector options from the synchronized Auth read model. */
router.get('/inspectors', asyncHandler(async (req, res) => {
  const inspectors = await listInspectorOptions(actor(res).officeBranchId);
  send(req, res, { inspectors });
}));

/** Branch-scoped approved quotations from the local Marketing snapshot read model. */
router.get('/quotations', asyncHandler(async (req, res) => {
  const { officeBranchId } = actor(res);
  const quotations = await prisma.quotationSnapshot.findMany({
    where: { officeBranchId },
    select: { quotationId: true, quotationVersion: true, revision: true, payload: true, approvedAt: true },
    orderBy: [{ approvedAt: 'desc' }, { quotationId: 'asc' }],
    take: 1000,
  });
  const options = quotations.flatMap(row => {
    const quotation = row.payload as Record<string, unknown>;
    const items = Array.isArray(quotation.items) ? (quotation.items as Record<string, unknown>[]) : [];
    // Contract-priced quotations are not selectable; they must use the contract basis.
    const contractPriced = items.some(item => {
      const selection = item.priceSelection;
      return Boolean(selection) && typeof selection === 'object'
        && (selection as Record<string, unknown>).priceSource === 'CONTRACT';
    });
    if (quotation.isActive !== true || quotation.status !== 'APPROVED' || contractPriced) return [];
    return [{
      id: row.quotationId,
      number: quotation.no ?? null,
      numberYear: quotation.numberYear ?? null,
      subject: quotation.subject ?? '',
      company: quotation.companySnapshot ?? null,
      quotationVersion: row.quotationVersion,
      revision: row.revision,
      approvedAt: row.approvedAt,
    }];
  });
  send(req, res, { quotations: options });
}));

export default router;
