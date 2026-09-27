import { z } from 'zod';
import { Router, RequestHandler } from 'express';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { quotationController } from './quotation.controller.js';
import { quotationIdSchema, listQuotationsSchema, createQuotationSchema, deactivateQuotationSchema, approveQuotationSchema, submitQuotationSchema, rejectQuotationSchema, reviseQuotationSchema, updateQuotationSchema, addQuotationItemSchema, deleteQuotationItemSchema } from './quotation.schemas.js';
import { HttpError } from '../../utils/httpError.js';

const requireMarketingSection: RequestHandler = (_req, res, next) => {
  if (res.locals.authUser?.section !== 'MARKETING') {
    next(new HttpError('Marketing section is required', 403));
    return;
  }
  next();
};

const requireMarketingAdmin: RequestHandler = (_req, res, next) => {
  const user = res.locals.authUser;
  if (user?.role !== 'ADMIN' || user.section !== 'MARKETING') {
    next(new HttpError('Marketing admin role is required', 403));
    return;
  }
  next();
};

const router = Router();
router.get('/:quotationId/pdf', validate('params', quotationIdSchema), asyncHandler(quotationController.preview));
router.post('/:quotationId/approve', requireMarketingAdmin, validate('params', quotationIdSchema), validate('body', approveQuotationSchema), asyncHandler(quotationController.approve));
router.post('/:quotationId/submit', requireMarketingSection, validate('params', quotationIdSchema), validate('body', submitQuotationSchema), asyncHandler(quotationController.submit));
router.post('/:quotationId/reject', requireMarketingAdmin, validate('params', quotationIdSchema), validate('body', rejectQuotationSchema), asyncHandler(quotationController.reject));
router.post('/:quotationId/revise', requireMarketingAdmin, validate('params', quotationIdSchema), validate('body', reviseQuotationSchema), asyncHandler(quotationController.revise));

router.get('/', validate('query', listQuotationsSchema), asyncHandler(quotationController.list));
router.get('/:quotationId', validate('params', quotationIdSchema), asyncHandler(quotationController.get));
router.patch('/:quotationId', validate('params', quotationIdSchema), validate('body', updateQuotationSchema), asyncHandler(quotationController.update));
router.post('/:quotationId/items', validate('params', quotationIdSchema), validate('body', addQuotationItemSchema), asyncHandler(quotationController.addItem));
router.delete('/:quotationId/items/:itemId', validate('params', quotationIdSchema.extend({ itemId: z.string().uuid() })), validate('body', deleteQuotationItemSchema), asyncHandler(quotationController.deleteItem));

router.post('/', validate('body', createQuotationSchema), asyncHandler(quotationController.create));
router.delete('/:quotationId', validate('params', quotationIdSchema), validate('body', deactivateQuotationSchema), asyncHandler(quotationController.delete));
export default router;
