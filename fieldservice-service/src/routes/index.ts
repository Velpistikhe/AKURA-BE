import { Router } from 'express';
import workOrderRoutes from '../modules/work-orders/work-order.routes.js';
import optionRoutes from '../modules/options/option.routes.js';
const router = Router();
router.use('/work-orders', workOrderRoutes);
router.use('/options', optionRoutes);
export default router;
