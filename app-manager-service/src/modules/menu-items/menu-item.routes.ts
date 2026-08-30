import { Router } from 'express';
import { requireAppManager } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { menuItemController } from './menu-item.controller.js';
import {
  createMenuItemSchema,
  listMenuItemsSchema,
  menuItemIdSchema,
  updateMenuItemSchema,
} from './menu-item.schemas.js';

const router = Router();

router.use(asyncHandler(requireAppManager));

router.get('/', validate('query', listMenuItemsSchema), asyncHandler(menuItemController.list));
router.get('/:menuItemId', validate('params', menuItemIdSchema), asyncHandler(menuItemController.get));
router.post('/', validate('body', createMenuItemSchema), asyncHandler(menuItemController.create));
router.patch(
  '/:menuItemId',
  validate('params', menuItemIdSchema),
  validate('body', updateMenuItemSchema),
  asyncHandler(menuItemController.update)
);
router.delete('/:menuItemId', validate('params', menuItemIdSchema), asyncHandler(menuItemController.delete));

export default router;
