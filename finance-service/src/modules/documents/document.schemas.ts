import { z } from 'zod';
const date = z.string().date().transform(value => new Date(`${value}T00:00:00.000Z`));
const fields = {
  number: z.string().trim().min(1).max(100).transform(value => value.toUpperCase()),
  title: z.string().trim().min(1).max(255), date,
  dueDate: date.nullable().optional(),
  notes: z.string().trim().max(20000).nullable().optional(),
  status: z.enum(['DRAFT', 'ON_PROGRESS', 'FINAL']).optional(),
};
export const versionSchema = z.number().int().min(0).max(2147483646);
// Amounts arrive as decimal strings so no floating point rounding can enter the ledger.
const money = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/);
const quantity = z.string().regex(/^\d{1,15}(\.\d{1,3})?$/);
// One quotation line as forwarded by Marketing, including its unit prices.
export const financeQuotationLineSchema = z.object({
  id: z.string().uuid(), position: z.number().int().nonnegative(), itemSizeId: z.string().uuid(),
  serviceName: z.string().min(1), serviceType: z.string().min(1), itemName: z.string().min(1),
  size: z.string().nullable(), note: z.string().nullable(),
  quantityInspection: quantity, quantityMaintenance: quantity,
  priceInspection: money, priceMaintenance: money.nullable(), discount: money, subTotal: money,
}).passthrough();
// The quotation snapshot Marketing forwards. Extra columns are tolerated because
// the snapshot is stored as a whole, but every billed field is validated.
// tax is the rate approved on the quotation and workOrderStatus the mirrored
// Field Service status; both are checked against Field Service before billing.
export const financeQuotationSchema = z.object({
  id: z.string().uuid(), officeBranchId: z.string().uuid(), version: z.number().int().nonnegative(),
  isActive: z.boolean(), status: z.string(), subject: z.string(),
  tax: money, workOrderStatus: z.enum(['DRAFT', 'IN_PROGRESS', 'COMPLETED']).nullable().optional(),
  subTotal: money, taxAmount: money, total: money,
  items: z.array(financeQuotationLineSchema).min(1, 'At least one quotation item is required').max(100).refine(items => new Set(items.map(item => item.id)).size === items.length && new Set(items.map(item => item.itemSizeId)).size === items.length, 'Duplicate quotation item'),
}).passthrough();
// Quotation billing requires a payment deadline.
export const createFromMarketingSchema = z.object({
  quotation: financeQuotationSchema,
  dueDate: date,
  notes: fields.notes,
}).strict();
export const directLineSchema = z.object({
  itemSizeId: z.string().uuid(), quantityInspection: quantity, quantityMaintenance: quantity,
  priceInspection: money, priceMaintenance: money.nullable(),
  note: z.string().trim().max(5000).nullable().optional(),
}).strict().refine(line => /[1-9]/.test(line.quantityInspection) || /[1-9]/.test(line.quantityMaintenance), 'At least one quantity must be positive');
export const directCreateSchema = z.object({
  source: z.literal('DIRECT'), companyId: z.string().uuid(), title: fields.title,
  items: z.array(directLineSchema).min(1).max(100).refine(lines => new Set(lines.map(line => line.itemSizeId.toLowerCase())).size === lines.length, 'Duplicate item size'),
  dueDate: fields.dueDate, notes: fields.notes,
}).strict();
export const documentCreateSchema = z.discriminatedUnion('source', [
  createFromMarketingSchema.extend({ source: z.literal('QUOTATION') }), directCreateSchema,
]);
export const approveSchema = z.object({ version: versionSchema }).strict();
export const createSchema = documentCreateSchema;
export const createProformaSchema = documentCreateSchema;
export const updateProformaSchema = z.object(fields).omit({ number: true, date: true }).partial().extend({ version: versionSchema, reason: z.string().trim().min(1).max(1000).optional() }).strict().refine(value => Object.keys(value).some(key => !['version','reason'].includes(key)), 'At least one editable field is required');
export const createInvoiceSchema = documentCreateSchema;
export const updateInvoiceSchema = z.object(fields).omit({ number: true, date: true }).partial().extend({ version: versionSchema, reason: z.string().trim().min(1).max(1000).optional() }).strict().refine(value => Object.keys(value).some(key => !['version','reason'].includes(key)), 'At least one editable field is required');
export const updateSchema = z.object({ ...fields }).partial().extend({ version: versionSchema, reason: z.string().trim().min(1).max(1000).optional() }).strict().refine(value => Object.keys(value).some(key => !['version','reason'].includes(key)), 'At least one editable field is required');
export const deleteSchema = z.object({ version: versionSchema, reason: z.string().trim().min(1).max(1000).optional() }).strict();
export const idSchema = z.string().uuid();
export const listSchema = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), quotationId: z.string().uuid().optional(), status: z.enum(['DRAFT','ON_PROGRESS','FINAL']).optional(), search: z.string().trim().max(100).optional() }).strict();
export const historySchema = listSchema.pick({ page: true, limit: true });

export const marketingDocumentReferenceSchema = z.object({
  quotationId: z.string().uuid(), kind: z.enum(['INVOICE', 'PROFORMA_INVOICE']),
  dueDate: date, location: z.string().trim().min(1).max(255),
}).strict();
