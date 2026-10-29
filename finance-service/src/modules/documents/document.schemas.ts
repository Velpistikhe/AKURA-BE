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
// One collection creates both document kinds, so the kind is part of every
// create request instead of the URL path.
export const documentKindSchema = z.enum(['INVOICE', 'PROFORMA_INVOICE']);
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
  contractId: z.string().uuid().nullable().optional(),
  subTotal: money, taxAmount: money, total: money,
  items: z.array(financeQuotationLineSchema).min(1, 'At least one quotation item is required').max(100).refine(items => new Set(items.map(item => item.id)).size === items.length && new Set(items.map(item => item.itemSizeId)).size === items.length, 'Duplicate quotation item'),
}).passthrough();
// A document created from a purchase order. The client sends only the item
// size UUIDs: Finance resolves the catalog data and the current price of
// every item from Marketing for the given company before the document is
// saved, so a stale client can never bill an outdated rate.
export const documentCreateSchema = z.object({
  kind: documentKindSchema, companyId: z.string().uuid(), title: fields.title,
  purchaseOrderNumber: z.string().trim().min(1).max(100),
  purchaseOrderDate: date,
  location: z.string().trim().min(1).max(255).nullable().optional(),
  items: z.array(z.string().uuid()).min(1).max(100)
    .refine(ids => new Set(ids.map(id => id.toLowerCase())).size === ids.length, 'Duplicate item size'),
  dueDate: fields.dueDate, notes: fields.notes,
}).strict();
export const approveSchema = z.object({ version: versionSchema }).strict();
// Number and date are server-generated for both kinds and cannot be edited.
export const updateSchema = z.object(fields).omit({ number: true, date: true }).partial().extend({ version: versionSchema, reason: z.string().trim().min(1).max(1000).optional() }).strict().refine(value => Object.keys(value).some(key => !['version','reason'].includes(key)), 'At least one editable field is required');
export const deleteSchema = z.object({ version: versionSchema, reason: z.string().trim().min(1).max(1000).optional() }).strict();
export const idSchema = z.string().uuid();
// kind is optional: an omitted kind lists invoices and proforma invoices together.
export const listSchema = z.object({ page: z.coerce.number().int().min(1).max(1000000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), kind: documentKindSchema.optional(), quotationId: z.string().uuid().optional(), status: z.enum(['DRAFT','ON_PROGRESS','FINAL']).optional(), search: z.string().trim().max(100).optional() }).strict();
export const historySchema = listSchema.pick({ page: true, limit: true });

export const marketingDocumentReferenceSchema = z.object({
  quotationId: z.string().uuid(), kind: documentKindSchema,
  dueDate: date, location: z.string().trim().min(1).max(255),
}).strict();
