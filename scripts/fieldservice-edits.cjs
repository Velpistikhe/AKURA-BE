const { patch } = require('./apply-finance-edits.cjs');

// Finance reads the Work Order of a quotation while billing it, so the
// read-only lookup accepts the FINANCE and ACCOUNTING sections as well.
patch('fieldservice-service/src/middlewares/actor.middleware.ts',
`export const requireWorkOrderSection = (...sections: string[]) => (_req: Request, res: Response, next: NextFunction) => {
  if (!sections.includes(res.locals.workOrderSection)) return next(new HttpError('Access to this section is required', 403));
  next();
};`,
`export const requireWorkOrderSection = (...sections: string[]) => (_req: Request, res: Response, next: NextFunction) => {
  if (!sections.includes(res.locals.workOrderSection)) return next(new HttpError('Access to this section is required', 403));
  next();
};
/**
 * Actor guard for the read-only Work Order lookup that Finance uses while
 * billing a quotation. Finance and Accounting need the Work Order status and
 * its stored quotation snapshot; no other Field Service route accepts them.
 */
export const requireWorkOrderReferenceSection = (_req: Request, res: Response, next: NextFunction) => {
  const section = res.locals.workOrderSection;
  if (section && !['FINANCE', 'ACCOUNTING'].includes(section)) return next(new HttpError('Access to this section is required', 403));
  next();
};`);

// The lookup keeps the general actor guard and only relaxes the section check.
patch('fieldservice-service/src/modules/work-orders/work-order.routes.ts',
`import { Actor, requireActor, requireWorkOrderSection } from '../../middlewares/actor.middleware.js';`,
`import { Actor, requireActor, requireWorkOrderReferenceSection, requireWorkOrderSection } from '../../middlewares/actor.middleware.js';`);

patch('fieldservice-service/src/modules/work-orders/work-order.routes.ts',
`router.get('/by-quotation/:quotationId', asyncHandler(async (req, res) => {
  const quotationId = z.string().uuid().parse(req.params.quotationId);
  send(req, res, await repository.findActiveByQuotation(quotationId, actor(res)));
}));`,
`// Read-only reference used by Finance while billing a quotation. It exposes
// the Work Order status and the stored quotation snapshot (tax rate only).
router.get('/by-quotation/:quotationId', requireWorkOrderReferenceSection, asyncHandler(async (req, res) => {
  const quotationId = z.string().uuid().parse(req.params.quotationId);
  send(req, res, await repository.findActiveByQuotation(quotationId, actor(res)));
}));`);
