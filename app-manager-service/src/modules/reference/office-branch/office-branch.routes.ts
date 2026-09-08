import { Router } from 'express';
import { requireAppManager } from '../../../middlewares/authorize.middleware.js';
import { validate } from '../../../middlewares/validate.middleware.js';
import { asyncHandler } from '../../../utils/asyncHandler.js';
import { officeBranchController } from './office-branch.controller.js';
import { createOfficeBranchSchema, listOfficeBranchesSchema, officeBranchIdSchema, updateOfficeBranchSchema } from './office-branch.schemas.js';

const router = Router();

router.use(asyncHandler(requireAppManager));
router.get('/', validate('query', listOfficeBranchesSchema), asyncHandler(officeBranchController.list));
router.get('/options', asyncHandler(officeBranchController.listOptions));
router.get('/:officeBranchId', validate('params', officeBranchIdSchema), asyncHandler(officeBranchController.get));
router.post('/', validate('body', createOfficeBranchSchema), asyncHandler(officeBranchController.create));
router.patch('/:officeBranchId', validate('params', officeBranchIdSchema), validate('body', updateOfficeBranchSchema), asyncHandler(officeBranchController.update));
router.delete('/:officeBranchId', validate('params', officeBranchIdSchema), asyncHandler(officeBranchController.delete));

export default router;
