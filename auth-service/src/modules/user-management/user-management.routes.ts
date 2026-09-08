import { Router } from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import { requireAppManager } from './user-management.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { userManagementController } from './user-management.controller.js';
import { listUsersSchema, updateUserSchema, userIdSchema } from './user-management.schemas.js';

const router = Router();
router.use(authenticate, asyncHandler(requireAppManager));
router.get('/', validate('query', listUsersSchema), asyncHandler(userManagementController.list));
router.get('/:userId', validate('params', userIdSchema), asyncHandler(userManagementController.get));
router.patch('/:userId', validate('params', userIdSchema), validate('body', updateUserSchema), asyncHandler(userManagementController.update));
export default router;
