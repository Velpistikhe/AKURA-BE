import { Router } from 'express';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { itemController, listItems } from './item.controller.js';
import {
  createItemSchema,
  itemIdSchema,
  listItemsSchema,
  updateItemSchema,
} from './item.schemas.js';

const router = Router();

router.get('/', validate('query', listItemsSchema), asyncHandler(listItems));
router.post('/', validate('body', createItemSchema), asyncHandler(itemController.create));
router.get('/:itemId', validate('params', itemIdSchema), asyncHandler(itemController.get));
router.patch(
  '/:itemId',
  validate('params', itemIdSchema),
  validate('body', updateItemSchema),
  asyncHandler(itemController.update),
);
router.delete('/:itemId', validate('params', itemIdSchema), asyncHandler(itemController.remove));

export default router;
