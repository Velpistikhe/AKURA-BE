import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { itemController, listItems } from './item.controller.js';
import { itemPriceController as prices } from './item-price.controller.js';
import { contractExcelController } from '../contracts/contract-excel.controller.js';
import { exportItemSizesSchema } from '../contracts/contract-excel.schemas.js';
import { versionSchema, updateItemSchema, updateItemSizeSchema, createItemPriceSchema, updateItemPriceSchema, createContractPriceSchema, updateContractPriceSchema, contractPriceIdSchema, catalogHistorySchema } from './item.schemas.js';
import {
  addItemSizeSchema,
  createItemSchema,
  itemIdSchema,
  itemSizeIdSchema,
  listItemSizesSchema,
  listContractItemSizesSchema,
  listItemsSchema,
} from './item.schemas.js';

const router = Router();

router.get('/', validate('query', listItemsSchema), asyncHandler(listItems));
router.post('/', validate('body', createItemSchema), asyncHandler(itemController.create));
router.get('/history', validate('query', catalogHistorySchema), asyncHandler(prices.history));
router.get('/contract-prices/:contractPriceId', validate('params', contractPriceIdSchema), asyncHandler(prices.getContract));
router.patch('/contract-prices/:contractPriceId', validate('params', contractPriceIdSchema), validate('body', updateContractPriceSchema), asyncHandler(prices.updateContract));
router.delete('/contract-prices/:contractPriceId', validate('params', contractPriceIdSchema), validate('body', versionSchema), asyncHandler(prices.removeContract));
router.get('/sizes', validate('query', listItemSizesSchema), asyncHandler(itemController.listSizes));
router.get('/sizes/export', validate('query', exportItemSizesSchema), asyncHandler(contractExcelController.download));
router.get('/sizes/prices', validate('query', listContractItemSizesSchema), asyncHandler(prices.resolvedPrices));
router.get('/sizes/contract-prices', validate('query', listContractItemSizesSchema), asyncHandler(itemController.listContractSizes));
router.post('/sizes', validate('body', addItemSizeSchema), asyncHandler(itemController.addSize));
router.get('/sizes/:itemSizeId', validate('params', itemSizeIdSchema), asyncHandler(prices.getSize));
router.patch('/sizes/:itemSizeId', validate('params', itemSizeIdSchema), validate('body', updateItemSizeSchema), asyncHandler(prices.updateSize));
router.delete('/sizes/:itemSizeId', validate('params', itemSizeIdSchema), validate('body', versionSchema), asyncHandler(itemController.removeSize));
router.get('/sizes/:itemSizeId/price', validate('params', itemSizeIdSchema), asyncHandler(prices.getPrice));
router.post('/sizes/:itemSizeId/price', validate('params', itemSizeIdSchema), validate('body', createItemPriceSchema), asyncHandler(prices.createPrice));
router.patch('/sizes/:itemSizeId/price', validate('params', itemSizeIdSchema), validate('body', updateItemPriceSchema), asyncHandler(prices.updatePrice));
router.delete('/sizes/:itemSizeId/price', validate('params', itemSizeIdSchema), validate('body', versionSchema), asyncHandler(prices.removePrice));
router.post('/sizes/:itemSizeId/contract-prices', validate('params', itemSizeIdSchema), validate('body', createContractPriceSchema), asyncHandler(prices.createContract));
router.get('/:itemId', validate('params', itemIdSchema), asyncHandler(itemController.get));
router.patch('/:itemId', validate('params', itemIdSchema), validate('body', updateItemSchema), asyncHandler(prices.updateItem));
router.delete('/:itemId', validate('params', itemIdSchema), validate('body', versionSchema), asyncHandler(itemController.remove));

export default router;
