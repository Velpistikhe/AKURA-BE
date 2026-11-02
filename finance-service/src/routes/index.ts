import { Router } from 'express';
import taxRoutes from '../modules/taxes/tax.routes.js';

const router = Router();
router.use('/taxes', taxRoutes);
export default router;
