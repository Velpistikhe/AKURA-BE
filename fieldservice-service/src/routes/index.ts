import { Router } from 'express';
import workOrderRoutes from '../modules/work-orders/work-order.routes.js';
const router = Router();
router.use('/work-orders', workOrderRoutes);
export default router;
