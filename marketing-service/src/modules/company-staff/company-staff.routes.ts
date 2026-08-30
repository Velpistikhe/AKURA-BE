import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { companyStaffController } from './company-staff.controller.js';
import { companyStaffIdSchema, createCompanyStaffSchema, listCompanyStaffSchema, updateCompanyStaffSchema } from './company-staff.schemas.js';

const router = Router();
router.get('/', validate('query', listCompanyStaffSchema), asyncHandler(companyStaffController.list));
router.get('/:companyStaffId', validate('params', companyStaffIdSchema), asyncHandler(companyStaffController.get));
router.post('/', validate('body', createCompanyStaffSchema), asyncHandler(companyStaffController.create));
router.patch('/:companyStaffId', validate('params', companyStaffIdSchema), validate('body', updateCompanyStaffSchema), asyncHandler(companyStaffController.update));
router.delete('/:companyStaffId', validate('params', companyStaffIdSchema), asyncHandler(companyStaffController.delete));
export default router;
