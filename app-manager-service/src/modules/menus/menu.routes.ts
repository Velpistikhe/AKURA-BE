import { Router } from 'express';
import { requireAppManager, requireAuthenticated } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { menuController } from './menu.controller.js';
import { createMenuSchema, listMenusSchema, menuIdSchema, updateMenuSchema } from './menu.schemas.js';

const router = Router();

// ─── Endpoint publik (semua role aktif) ───────────────────────────────────────
router.get('/my-menus', asyncHandler(requireAuthenticated), asyncHandler(menuController.getMyMenus));

// ─── CRUD — hanya app_manager ─────────────────────────────────────────────────
router.use(asyncHandler(requireAppManager));

router.get('/', validate('query', listMenusSchema), asyncHandler(menuController.list));
router.get('/:menuId', validate('params', menuIdSchema), asyncHandler(menuController.get));
router.post('/', validate('body', createMenuSchema), asyncHandler(menuController.create));
router.patch('/:menuId', validate('params', menuIdSchema), validate('body', updateMenuSchema), asyncHandler(menuController.update));
router.delete('/:menuId', validate('params', menuIdSchema), asyncHandler(menuController.delete));

export default router;

