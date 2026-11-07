import { Router } from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import { requireAppManager } from './user-management.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { userManagementController } from './user-management.controller.js';
import { listUsersSchema, updateUserSchema, userIdSchema } from './user-management.schemas.js';

const router = Router();
// Every route requires a valid access token. The list is available to any
// authenticated caller, because the visibility scope follows the caller's role;
// reading and updating a single user stay reserved for an app manager.
router.use(authenticate);
router.get('/', validate('query', listUsersSchema), asyncHandler(userManagementController.list));
router.get('/:userId', asyncHandler(requireAppManager), validate('params', userIdSchema), asyncHandler(userManagementController.get));
router.patch('/:userId', asyncHandler(requireAppManager), validate('params', userIdSchema), validate('body', updateUserSchema), asyncHandler(userManagementController.update));
export default router;
