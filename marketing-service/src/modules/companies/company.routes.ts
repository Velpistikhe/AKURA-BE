import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { companyController } from './company.controller.js';
import { companyHistorySchema, companyIdSchema, createCompanySchema, listCompaniesSchema, updateCompanySchema } from './company.schemas.js';

const router = Router();
router.get('/:companyId/history', validate('params', companyIdSchema), validate('query', companyHistorySchema), asyncHandler(companyController.history));
router.get('/:companyId/staff-history', validate('params', companyIdSchema), validate('query', companyHistorySchema), asyncHandler(companyController.staffHistory));
router.get('/', validate('query', listCompaniesSchema), asyncHandler(companyController.list));
router.get('/:companyId', validate('params', companyIdSchema), asyncHandler(companyController.get));
router.post('/', validate('body', createCompanySchema), asyncHandler(companyController.create));
router.patch('/:companyId', validate('params', companyIdSchema), validate('body', updateCompanySchema), asyncHandler(companyController.update));
export default router;
