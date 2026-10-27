import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { Actor, requireActor } from '../../middlewares/actor.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { loadQuotationForBasis, loadQuotationOptions } from '../../integrations/gateway.js';
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
 * Branch-scoped quotation detail used by the Work Order creation form: the
 * approved quotation of the authenticated branch with its active item lines.
 * The lines are projected through an explicit allowlist, so no price field of
 * the Marketing quotation can reach the client.
 */
router.get('/quotations/:quotationId', asyncHandler(async (req, res) => {
  const quotationId = z.string().uuid().parse(req.params.quotationId);
  const quotation = await loadQuotationForBasis(req, quotationId, actor(res).officeBranchId);
  send(req, res, { quotation: {
    id: quotation.id, no: quotation.no, numberYear: quotation.numberYear,
    subject: quotation.subject, company: quotation.companySnapshot,
    items: quotation.items.filter(item => item.isActive !== false).map(item => ({
      itemSizeId: item.itemSizeId, serviceName: item.serviceName, serviceType: item.serviceType,
      itemName: item.itemName, size: item.size ?? null,
      quantityInspection: item.quantityInspection, quantityMaintenance: item.quantityMaintenance,
      inspectionScope: item.inspectionScopes ?? '', maintenanceScope: item.maintenanceScopes ?? '',
    })),
  } });
}));

/**
 * Branch-scoped approved quotations resolved live from Marketing. Marketing
 * returns active APPROVED quotations with any price source in the
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
