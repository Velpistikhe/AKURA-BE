import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { serviceController } from './service.controller.js';
import { createMaintenanceScopeSchema, maintenanceScopeIdSchema, createServiceSchema, createInspectionScopeSchema, deactivateServiceSchema, listServicesSchema, serviceHistorySchema, serviceIdSchema, inspectionScopeIdSchema, updateServiceSchema } from './service.schemas.js';

const router = Router();
router.get('/', validate('query', listServicesSchema), asyncHandler(serviceController.list));
router.get('/:serviceId/history', validate('params', serviceIdSchema), validate('query', serviceHistorySchema), asyncHandler(serviceController.history));
router.get('/:serviceId', validate('params', serviceIdSchema), asyncHandler(serviceController.get));
router.post('/', validate('body', createServiceSchema), asyncHandler(serviceController.create));
router.patch('/:serviceId', validate('params', serviceIdSchema), validate('body', updateServiceSchema), asyncHandler(serviceController.update));
router.post('/:serviceId/inspection/scopes', validate('params', serviceIdSchema), validate('body', createInspectionScopeSchema), asyncHandler(serviceController.createInspectionScope));
router.post('/:serviceId/maintenance/scopes', validate('params', serviceIdSchema), validate('body', createMaintenanceScopeSchema), asyncHandler(serviceController.createMaintenanceScope));
router.delete('/:serviceId/maintenance/scopes/:scopeId', validate('params', maintenanceScopeIdSchema), asyncHandler(serviceController.deleteMaintenanceScope));
router.delete('/:serviceId/inspection/scopes/:inspectionScopeId', validate('params', inspectionScopeIdSchema), asyncHandler(serviceController.deleteInspectionScope));
router.delete('/:serviceId', validate('params', serviceIdSchema), validate('body', deactivateServiceSchema), asyncHandler(serviceController.delete));
export default router;
