import { Router } from 'express';
import { requireAppManager } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { auditTrailController } from './audit-trail.controller.js';
import { auditTrailEntitySchema, listAuditTrailSchema } from './audit-trail.schemas.js';

const router = Router();

router.use(asyncHandler(requireAppManager));
router.get('/', validate('query', listAuditTrailSchema), asyncHandler(auditTrailController.list));
router.get('/entity/:entityId', validate('params', auditTrailEntitySchema), asyncHandler(auditTrailController.listForEntity));

export default router;
