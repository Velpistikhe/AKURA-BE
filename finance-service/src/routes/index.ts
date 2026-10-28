import { documentRoutes, marketingDocumentRoutes } from '../modules/documents/document.routes.js';
import { Router } from 'express';
import taxRoutes from '../modules/taxes/tax.routes.js';
const router = Router();
// One collection serves invoices and proforma invoices; the kind travels in the
// payload so a document can be created without any source document.
router.use('/documents', documentRoutes());
router.use('/documents', marketingDocumentRoutes);
router.use('/taxes', taxRoutes);
export default router;
