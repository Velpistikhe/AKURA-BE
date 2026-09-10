import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { itemController, listItems } from './item.controller.js';
import {
  addItemSizeSchema,
  createItemSchema,
  itemIdSchema,
  itemSizeIdSchema,
  listItemSizesSchema,
  listItemsSchema,
} from './item.schemas.js';

const router = Router();

router.get('/', validate('query', listItemsSchema), asyncHandler(listItems));
router.post('/', validate('body', createItemSchema), asyncHandler(itemController.create));
router.get('/sizes', validate('query', listItemSizesSchema), asyncHandler(itemController.listSizes));
router.post('/sizes', validate('body', addItemSizeSchema), asyncHandler(itemController.addSize));
router.delete('/sizes/:itemSizeId', validate('params', itemSizeIdSchema), asyncHandler(itemController.removeSize));
router.get('/:itemId', validate('params', itemIdSchema), asyncHandler(itemController.get));
router.delete('/:itemId', validate('params', itemIdSchema), asyncHandler(itemController.remove));

export default router;
