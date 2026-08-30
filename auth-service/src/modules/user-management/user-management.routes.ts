import { Router } from 'express';
import { authenticate } from '../../middlewares/auth.middleware.js';
import { requireAppManager } from '../../middlewares/appManager.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { userManagementController } from './user-management.controller.js';
import { listUsersSchema, setRoleSchema, setSectionSchema, setStatusSchema, userIdSchema } from './user-management.schemas.js';

const router = Router();
router.use(authenticate, asyncHandler(requireAppManager));
router.get('/', validate('query', listUsersSchema), asyncHandler(userManagementController.list));
router.get('/:userId', validate('params', userIdSchema), asyncHandler(userManagementController.get));
router.patch('/:userId/role', validate('params', userIdSchema), validate('body', setRoleSchema), asyncHandler(userManagementController.setRole));
router.patch('/:userId/section', validate('params', userIdSchema), validate('body', setSectionSchema), asyncHandler(userManagementController.setSection));
router.patch('/:userId/status', validate('params', userIdSchema), validate('body', setStatusSchema), asyncHandler(userManagementController.setStatus));
export default router;
