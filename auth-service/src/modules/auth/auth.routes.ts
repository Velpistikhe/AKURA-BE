import { Router } from 'express';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  updateProfileSchema,
} from './auth.schemas.js';
import { authController } from './auth.controller.js';
import { authenticate } from './auth.middleware.js';
import { validateBody } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.post('/register', validateBody(registerSchema), asyncHandler(authController.register));
router.post('/login', validateBody(loginSchema), asyncHandler(authController.login));
router.post('/refresh-token', asyncHandler(authController.refreshToken));
router.post('/logout', asyncHandler(authController.logout));

router.use(authenticate);
router.get('/me', asyncHandler(authController.getProfile));
router.put('/profile', validateBody(updateProfileSchema), asyncHandler(authController.updateProfile));
router.put('/password', validateBody(changePasswordSchema), asyncHandler(authController.changePassword));

export default router;
