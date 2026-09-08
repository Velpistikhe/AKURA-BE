import { Router } from 'express';
import menuItemRoutes from '../modules/menu/menu-items/menu-item.routes.js';
import menuAccessRoutes from '../modules/menu/menu-accesses/menu-access.routes.js';
import menuRoutes from '../modules/menu/menus/menu.routes.js';
import officeBranchRoutes from '../modules/reference/office-branch/office-branch.routes.js';

const router = Router();

router.use('/menus', menuRoutes);
router.use('/menu-items', menuItemRoutes);
router.use('/menu-accesses', menuAccessRoutes);
router.use('/office-branches', officeBranchRoutes);

export default router;
