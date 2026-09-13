import { Router } from 'express';
import proformainvoicesRoutes from '../modules/proforma-invoices/proforma-invoices.routes.js';
import invoicesRoutes from '../modules/invoices/invoices.routes.js';
import taxRoutes from '../modules/taxes/tax.routes.js';
const router = Router();
router.use('/taxes', taxRoutes);
router.use('/proforma-invoices',proformainvoicesRoutes);
router.use('/invoices',invoicesRoutes);
export default router;
