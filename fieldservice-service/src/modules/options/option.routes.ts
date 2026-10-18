import { Request, Response, Router } from 'express';
import { Actor, requireActor } from '../../middlewares/actor.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { loadQuotationOptions } from '../../integrations/gateway.js';
import { listInspectorOptions } from '../user-sync/user-sync.repository.js';

const router = Router();
const actor = (res: Response): Actor => res.locals.workOrderActor;
const send = (req: Request, res: Response, data: unknown) => res.status(200).json({
  status: 200, success: true, message: 'Request completed successfully', data,
  requestId: req.headers['x-request-id'],
});

router.use(requireActor);

/** Branch-scoped active inspector options: the raw synchronized Auth user snapshots. */
router.get('/inspectors', asyncHandler(async (req, res) => {
  const inspectors = await listInspectorOptions(actor(res).officeBranchId);
  send(req, res, { inspectors });
}));

/**
 * Branch-scoped approved quotations resolved live from Marketing. Marketing
 * already filters to active APPROVED non-contract-priced quotations of the
 * authenticated branch and caps the list; the response shape is unchanged for
 * existing consumers.
 */
router.get('/quotations', asyncHandler(async (req, res) => {
  const quotations = await loadQuotationOptions(req);
  send(req, res, { quotations: quotations.map(option => ({
    id: option.id,
    number: option.no ?? null,
    numberYear: option.numberYear ?? null,
    subject: option.subject ?? '',
    company: option.companySnapshot ?? null,
    quotationVersion: option.version,
    revision: option.revision,
    approvedAt: option.approvedAt,
  })) });
}));

export default router;
