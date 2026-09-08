import { Router } from 'express';
import { requireAppManager } from '../../../middlewares/authorize.middleware.js';
import { validate } from '../../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { menuAccessController } from './menu-access.controller.js';
import { createMenuAccessSchema, listMenuAccessesSchema, menuAccessIdSchema, updateMenuAccessSchema } from './menu-access.schemas.js';

const router = Router();

router.use(asyncHandler(requireAppManager));
router.get('/', validate('query', listMenuAccessesSchema), asyncHandler(menuAccessController.list));
router.get('/:menuAccessId', validate('params', menuAccessIdSchema), asyncHandler(menuAccessController.get));
router.post('/', validate('body', createMenuAccessSchema), asyncHandler(menuAccessController.create));
router.patch('/:menuAccessId', validate('params', menuAccessIdSchema), validate('body', updateMenuAccessSchema), asyncHandler(menuAccessController.update));
router.delete('/:menuAccessId', validate('params', menuAccessIdSchema), asyncHandler(menuAccessController.delete));

export default router;
