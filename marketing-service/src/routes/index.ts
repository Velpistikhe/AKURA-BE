import { Router } from 'express';
import companyRoutes from '../modules/companies/company.routes.js';
import companyStaffRoutes from '../modules/company-staff/company-staff.routes.js';
import serviceRoutes from '../modules/services/service.routes.js';
import itemRoutes from '../modules/items/item.routes.js';
import contractRoutes from '../modules/contracts/contract.routes.js';
import quotationRoutes from '../modules/quotations/quotation.routes.js';
import { requireMarketingAccess } from '../middlewares/authorize.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.use(asyncHandler(requireMarketingAccess));
router.use('/companies', companyRoutes);
router.use('/company-staffs', companyStaffRoutes);
router.use('/services', serviceRoutes);
router.use('/items', itemRoutes);
router.use('/company-contracts', contractRoutes);
router.use('/quotations', quotationRoutes);
export default router;
