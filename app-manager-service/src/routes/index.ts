import { Router } from 'express';
import menuItemRoutes from '../modules/menu-items/menu-item.routes.js';
import menuAccessRoutes from '../modules/menu-accesses/menu-access.routes.js';
import menuRoutes from '../modules/menus/menu.routes.js';

const router = Router();

router.use('/menus', menuRoutes);
router.use('/menu-items', menuItemRoutes);
router.use('/menu-accesses', menuAccessRoutes);

export default router;
