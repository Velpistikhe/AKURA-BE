import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { getOfficeBranchId, restrictListVisibility } from '../../utils/officeBranch.js';
import { contractPriceHistoryRepository } from './contract-price-history.repository.js';
import { contractPriceHistoryParamsSchema, contractPriceHistoryQuerySchema, listContractPricesSchema } from './contract-price-history.schemas.js';

const router = Router();
router.get('/', validate('query', listContractPricesSchema), asyncHandler(async (req, res) => {
  const data = await contractPriceHistoryRepository.listPrices({ ...restrictListVisibility(res, res.locals.query), isActive: true }, getOfficeBranchId(res));
  res.status(200).json({ status: 200, success: true, data, requestId: req.headers['x-request-id'] });
}));
router.get('/:contractPriceId/history', validate('params', contractPriceHistoryParamsSchema), validate('query', contractPriceHistoryQuerySchema), asyncHandler(async (req, res) => {
  const data = await contractPriceHistoryRepository.list(res.locals.params.contractPriceId, res.locals.query, getOfficeBranchId(res));
  res.status(200).json({ status: 200, success: true, data, requestId: req.headers['x-request-id'] });
}));

export default router;
