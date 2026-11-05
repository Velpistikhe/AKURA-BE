import { Router } from 'express';
import { authenticate } from '../auth/auth.middleware.js';
import { requireAppManager } from './user-management.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { userManagementController } from './user-management.controller.js';
import { inspectUsersQuerySchema, listUsersSchema, updateUserSchema, userIdSchema } from './user-management.schemas.js';
import { prisma } from '../../config/db.js';
import { AuthenticatedRequest } from '../auth/auth.middleware.js';

const router = Router();
// Internal contact directory for Marketing quotation PDFs. Read-only; branch always comes
// from the calling authenticated user, never from a request parameter.
router.get('/marketing-contacts', authenticate, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const actor = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { officeBranchId: true } });
  const users = actor?.officeBranchId ? await prisma.user.findMany({
    where: { officeBranchId: actor.officeBranchId, role: 'ADMIN', section: 'MARKETING', isActive: true },
    select: { firstName: true, lastName: true, email: true, telp: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 20,
  }) : [];
  res.status(200).json({
    status: 200, success: true, message: 'Marketing contacts retrieved successfully',
    data: { contacts: users.map(user => ({ name: `${user.firstName} ${user.lastName}`.trim(), email: user.email, telp: user.telp })) },
    requestId: req.headers['x-request-id'],
  });
}));
// Branch-scoped inspector validation for Field Service work-order start.
router.get('/field-service/inspectors', authenticate, validate('query', inspectUsersQuerySchema), asyncHandler(userManagementController.inspectors));
// Branch-scoped inspector directory for the Field Service Work Order forms.
// Read-only; the branch always comes from the calling authenticated user.
router.get('/field-service/inspector-directory', authenticate, asyncHandler(async (req: AuthenticatedRequest, res) => {
  const actor = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { officeBranchId: true } });
  const users = actor?.officeBranchId ? await prisma.user.findMany({
    where: { officeBranchId: actor.officeBranchId, section: 'FIELD_SERVICE', isActive: true },
    select: { id: true, username: true, firstName: true, lastName: true, email: true, telp: true, role: true, section: true, officeBranchId: true, isActive: true, version: true, createdAt: true, updatedAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 500,
  }) : [];
  res.status(200).json({
    status: 200, success: true, message: 'Field Service inspector directory retrieved successfully',
    data: { inspectors: users.map((user) => ({ ...user, createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString() })) },
    requestId: req.headers['x-request-id'],
  });
}));
router.use(authenticate, asyncHandler(requireAppManager));
router.get('/', validate('query', listUsersSchema), asyncHandler(userManagementController.list));
router.get('/:userId', validate('params', userIdSchema), asyncHandler(userManagementController.get));
router.patch('/:userId', validate('params', userIdSchema), validate('body', updateUserSchema), asyncHandler(userManagementController.update));
export default router;
