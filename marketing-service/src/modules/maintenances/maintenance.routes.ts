import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { maintenanceController } from './maintenance.controller.js';
import { createMaintenanceSchema, createMaintenanceScopeSchema, listMaintenancesSchema, maintenanceIdSchema, maintenanceScopeIdSchema } from './maintenance.schemas.js';

const router = Router();
router.get('/', validate('query', listMaintenancesSchema), asyncHandler(maintenanceController.list));
router.get('/:maintenanceId', validate('params', maintenanceIdSchema), asyncHandler(maintenanceController.get));
router.post('/', validate('body', createMaintenanceSchema), asyncHandler(maintenanceController.create));
router.post('/:maintenanceId/scopes', validate('params', maintenanceIdSchema), validate('body', createMaintenanceScopeSchema), asyncHandler(maintenanceController.createScope));
router.delete('/:maintenanceId/scopes/:scopeId', validate('params', maintenanceScopeIdSchema), asyncHandler(maintenanceController.deleteScope));
export default router;
