import { billingPricesSchema, resolveBillingPrices } from '../modules/items/billing-prices.js';
import { prisma } from '../config/db.js';
import { getOfficeBranchId } from '../utils/officeBranch.js';
import { contractIdSchema } from '../modules/contracts/contract.schemas.js';
import { itemSizeIdSchema } from '../modules/items/item.schemas.js';
import { itemScopeInclude, itemScopeSnapshot } from '../modules/quotations/quotation-service-groups.js';
import { companyIdSchema } from '../modules/companies/company.schemas.js';
import { contractRepository } from '../modules/contracts/contract.repository.js';
import { HttpError } from '../utils/httpError.js';
import { validate } from '../middlewares/validate.middleware.js';
import { quotationIdSchema } from '../modules/quotations/quotation.schemas.js';
import { quotationController } from '../modules/quotations/quotation.controller.js';
import { Router } from 'express';
import companyRoutes from '../modules/companies/company.routes.js';
import companyStaffRoutes from '../modules/company-staff/company-staff.routes.js';
import serviceRoutes from '../modules/services/service.routes.js';
import itemRoutes from '../modules/items/item.routes.js';
import contractRoutes from '../modules/contracts/contract.routes.js';
import quotationRoutes from '../modules/quotations/quotation.routes.js';
import contractPriceHistoryRoutes from '../modules/contract-prices/contract-price-history.routes.js';
import { requireMarketingAccess, requireQuotationReferenceAccess } from '../middlewares/authorize.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';

const router = Router();
router.post('/billing-price-references', asyncHandler(requireQuotationReferenceAccess), validate('body', billingPricesSchema), asyncHandler(async (req, res) => {
  const data = await resolveBillingPrices(res.locals.body, getOfficeBranchId(res));
  res.json({ status: 200, success: true, message: 'Billing prices resolved successfully', data, requestId: req.headers['x-request-id'] });
}));
router.get('/company-contract-references/:companyId', asyncHandler(requireQuotationReferenceAccess), validate('params', companyIdSchema), asyncHandler(async (req, res) => {
  const contract = await contractRepository.resolveCompanyReference(res.locals.params.companyId, getOfficeBranchId(res));
  res.json({ status: 200, success: true, data: contract, requestId: req.headers['x-request-id'] });
}));
router.get('/quotation-references', asyncHandler(requireQuotationReferenceAccess), asyncHandler(quotationController.listReference));
router.get('/quotation-references/:quotationId', asyncHandler(requireQuotationReferenceAccess), validate('params', quotationIdSchema), asyncHandler(quotationController.getReference));
router.get('/item-size-references/:itemSizeId', asyncHandler(requireQuotationReferenceAccess), validate('params', itemSizeIdSchema), asyncHandler(async (req, res) => {
  const branch = getOfficeBranchId(res);
  const size = await prisma.itemSize.findFirst({
    where: { id: res.locals.params.itemSizeId, item: { officeBranchId: branch } },
    include: itemScopeInclude,
  });
  if (!size) throw new HttpError('Item size not found', 404);
  if (!size.isActive || !size.item.isActive) throw new HttpError('Item size is inactive', 409);
  const service = size.item.service;
  if (service && (!service.isActive || service.officeBranchId !== branch)) throw new HttpError('Item size is inactive', 409);
  const scopes = itemScopeSnapshot(size.item);
  res.json({ status: 200, success: true, message: 'Item size reference retrieved successfully', data: {
    itemSizeId: size.id, serviceName: service?.name ?? size.item.name,
    inspectionScope: scopes.inspectionScopes, maintenanceScope: scopes.maintenanceScopes,
    itemName: size.item.name, size: size.size,
  }, requestId: req.headers['x-request-id'] });
}));
router.get('/contract-references/:contractId', asyncHandler(requireQuotationReferenceAccess), validate('params', contractIdSchema), asyncHandler(async (req, res) => {
  const contract = await prisma.companyContract.findFirst({ where: { id: res.locals.params.contractId, company: { officeBranchId: getOfficeBranchId(res), revoked: false } },
    include: { company: true, prices: { where: { isActive: true } } } });
  if (!contract) throw new HttpError('Contract not found', 404);
  res.json({ status: 200, success: true, data: contract, requestId: req.headers['x-request-id'] });
}));
router.use(asyncHandler(requireMarketingAccess));
router.use('/companies', companyRoutes);
router.use('/company-staffs', companyStaffRoutes);
router.use('/services', serviceRoutes);
router.use('/items', itemRoutes);
router.use('/company-contracts', contractRoutes);
router.use('/company-contract-prices', contractPriceHistoryRoutes);
router.use('/quotations', quotationRoutes);
export default router;
