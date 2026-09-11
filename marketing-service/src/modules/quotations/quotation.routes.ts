import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { quotationController } from './quotation.controller.js';
import { quotationIdSchema, listQuotationsSchema, createQuotationSchema, updateQuotationSchema, deactivateQuotationSchema } from './quotation.schemas.js';

const router = Router();
router.get('/', validate('query', listQuotationsSchema), asyncHandler(quotationController.list));
router.get('/:quotationId', validate('params', quotationIdSchema), asyncHandler(quotationController.get));
router.post('/', validate('body', createQuotationSchema), asyncHandler(quotationController.create));
router.patch('/:quotationId', validate('params', quotationIdSchema), validate('body', updateQuotationSchema), asyncHandler(quotationController.update));
router.delete('/:quotationId', validate('params', quotationIdSchema), validate('body', deactivateQuotationSchema), asyncHandler(quotationController.delete));
export default router;
