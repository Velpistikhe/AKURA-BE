import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { serviceController } from './service.controller.js';
import { createServiceMaintenanceSchema, createServiceSchema, createServiceScopeSchema, listServicesSchema, serviceIdSchema, serviceItemsQuerySchema, serviceScopeIdSchema } from './service.schemas.js';

const router = Router();
router.get('/', validate('query', listServicesSchema), asyncHandler(serviceController.list));
router.get('/:serviceId', validate('params', serviceIdSchema), validate('query', serviceItemsQuerySchema), asyncHandler(serviceController.get));
router.post('/', validate('body', createServiceSchema), asyncHandler(serviceController.create));
router.post('/:serviceId/scopes', validate('params', serviceIdSchema), validate('body', createServiceScopeSchema), asyncHandler(serviceController.createScope));
router.post('/:serviceId/maintenance/scopes', validate('params', serviceIdSchema), validate('body', createServiceScopeSchema), asyncHandler(serviceController.createMaintenanceScope));
router.post('/:serviceId/maintenance', validate('params', serviceIdSchema), validate('body', createServiceMaintenanceSchema), asyncHandler(serviceController.createMaintenance));
router.delete('/:serviceId/maintenance/scopes/:scopeId', validate('params', serviceScopeIdSchema), asyncHandler(serviceController.deleteMaintenanceScope));
router.delete('/:serviceId/scopes/:scopeId', validate('params', serviceScopeIdSchema), asyncHandler(serviceController.deleteScope));
router.delete('/:serviceId', validate('params', serviceIdSchema), asyncHandler(serviceController.delete));
export default router;
