import { z } from 'zod';
import { InquiryMethod, InvoiceStatus, QuotationStatus } from '@prisma/client';

export const quotationIdSchema = z.object({ quotationId: z.string().uuid() }).strict();
export const listQuotationsSchema = z.object({
  isActive: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  dateFrom: z.string().date().transform((value) => new Date(`${value}T00:00:00.000Z`)).optional(),
  dateTo: z.string().date().transform((value) => new Date(`${value}T00:00:00.000Z`)).optional(),
  no: z.coerce.number().int().min(1).max(2147483647).optional(),
  status: z.nativeEnum(QuotationStatus).optional(),
  company: z.string().trim().min(1).max(255).optional(),
  invoiceStatus: z.preprocess(value => value === 'null' ? null : value, z.nativeEnum(InvoiceStatus).nullable().optional()),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(value => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, {
  message: 'dateFrom must be on or before dateTo', path: ['dateTo'],
});
export type ListQuotationsInput = z.infer<typeof listQuotationsSchema>;

const text = z.string().trim().min(1).max(255);
// Supply descriptions are stored as PostgreSQL TEXT so internal newlines are preserved.
const supplyText = z.string().trim().min(1).max(5000);
const date = z.string().date().transform((value) => new Date(`${value}T00:00:00.000Z`));
// Accept decimal strings without passing through floating-point arithmetic.
const decimal = (scale: number) => z.string().regex(new RegExp(`^\\d{1,12}(\\.\\d{1,${scale}})?$`));
const quantity = z.union([decimal(3), z.number().finite().nonnegative().transform(String).pipe(decimal(3))]);
const note = z.string().trim().max(5000).nullable().optional();
const inspectors = z.array(z.string().uuid()).max(100)
  .refine(ids => new Set(ids).size === ids.length, 'Inspector IDs must be unique');
const itemFields = {
  id: z.string().uuid().optional(), itemSizeId: z.string().uuid(),
  note,
  quantityInspection: quantity,
  quantityMaintenance: quantity.default('0'),
};
const item = z.object(itemFields).strict().refine(value => /[1-9]/.test(value.quantityInspection) || /[1-9]/.test(value.quantityMaintenance), 'At least one quantity must be positive');
const items = z.array(item).min(1).max(100).refine((rows) => {
  const ids = rows.flatMap((row) => row.id ? [row.id] : []);
  return ids.length === new Set(ids).size;
}, 'Item IDs must be unique').refine(rows => new Set(rows.map(row => row.itemSizeId.toLowerCase())).size === rows.length, 'Each size may appear only once; enter both quantities on the same line');
const fields = {
  date: date.nullable().optional(),
  jobStart: z.string().trim().min(1).max(255),
  inquiryMethod: z.nativeEnum(InquiryMethod),
  inquiryDate: date,
  subject: text, termOfPayment: text, validity: text,
  supplyAkura: supplyText, supplyCustomer: supplyText, location: text,
  accomplished: text, deliveryReports: text,
  deliveryInvoice: text,
  companyId: z.string().uuid().optional(),
  staffId: z.string().uuid(),
  items,
};
export const createQuotationSchema = z.object(fields).strict()
  .refine(value => !!value.staffId, 'Staff is required')
  .refine((value) => value.items.every((row) => !row.id), 'New quotation items cannot supply IDs');
const isoDate = z.string().date();
export const createWorkOrderFromQuotationSchema = z.object({
  quotationId: z.string().uuid(),
  startDate: isoDate,
  endDate: isoDate,
  inspectors: inspectors,
}).strict()
  .refine(value => value.endDate >= value.startDate, 'endDate must be on or after startDate');
export type CreateWorkOrderFromQuotationInput = z.infer<typeof createWorkOrderFromQuotationSchema>;
export const deactivateQuotationSchema = z.object({ version: z.number().int().nonnegative().max(2147483646) }).strict();

// Read-only monitoring query for the quotation sync outbox. Access is restricted
// to ADMIN MARKETING by the route middleware; the listing is global across
// branches because sync outbox state is operational data, not branch data.
export const QUOTATION_SYNC_TARGET_SERVICES = ['fieldservice-service'] as const;
export const listQuotationSyncDeliveriesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'delivered']).optional(),
  targetService: z.enum(QUOTATION_SYNC_TARGET_SERVICES).optional(),
  quotationId: z.string().uuid('Invalid quotation ID').optional(),
}).strict();
export type ListQuotationSyncDeliveriesInput = z.infer<typeof listQuotationSyncDeliveriesSchema>;

// Manual re-dispatch trigger: retry pending outbox deliveries immediately.
// Branch-scoped to the caller; quotationId narrows the retry to one quotation.
// preprocess tolerates an omitted request body entirely.
export const redispatchQuotationSyncSchema = z.preprocess(value => value ?? {}, z.object({
  quotationId: z.string().uuid('Invalid quotation ID').optional(),
}).strict());
export type RedispatchQuotationSyncInput = z.infer<typeof redispatchQuotationSyncSchema>;
export const approveQuotationSchema = deactivateQuotationSchema;
export const submitQuotationSchema = deactivateQuotationSchema;
export const rejectQuotationSchema = deactivateQuotationSchema;
export const reviseQuotationSchema = deactivateQuotationSchema;
export const quotationHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  action: z.string().trim().min(1).max(20).optional(),
  sortBy: z.enum(['version', 'createdAt', 'action']).default('version'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
}).strict();

const editableHeaderFields = {
  jobStart: fields.jobStart.optional(), inquiryMethod: fields.inquiryMethod.optional(), inquiryDate: fields.inquiryDate.optional(),
  subject: fields.subject.optional(), termOfPayment: fields.termOfPayment.optional(), validity: fields.validity.optional(),
  supplyAkura: fields.supplyAkura.optional(), supplyCustomer: fields.supplyCustomer.optional(), location: fields.location.optional(),
  accomplished: fields.accomplished.optional(), deliveryReports: fields.deliveryReports.optional(), deliveryInvoice: fields.deliveryInvoice.optional(),
  staffId: fields.staffId.optional(),
};
export const updateQuotationSchema = z.object({
  version: z.number().int().nonnegative().max(2147483646), ...editableHeaderFields,
}).strict().refine(value => Object.keys(value).some(key => key !== 'version'), 'At least one editable field is required');
export const addQuotationItemSchema = z.object({
  version: z.number().int().nonnegative().max(2147483646), itemSizeId: itemFields.itemSizeId, note: itemFields.note,
  quantityInspection: itemFields.quantityInspection, quantityMaintenance: itemFields.quantityMaintenance,
}).strict();
export const deleteQuotationItemSchema = z.object({
  quotationVersion: z.number().int().nonnegative().max(2147483646),
  itemVersion: z.number().int().nonnegative().max(2147483646),
}).strict();
export type QuotationItemInput = z.infer<typeof item>;
export type UpdateQuotationInput = z.infer<typeof updateQuotationSchema>;
