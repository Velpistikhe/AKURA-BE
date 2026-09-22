import { z } from 'zod';
import { InquiryMethod } from '@prisma/client';

export const quotationIdSchema = z.object({ quotationId: z.string().uuid() }).strict();
export const listQuotationsSchema = z.object({
  isActive: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type ListQuotationsInput = z.infer<typeof listQuotationsSchema>;

const text = z.string().trim().min(1).max(255);
// Supply descriptions are stored as PostgreSQL TEXT so internal newlines are preserved.
const supplyText = z.string().trim().min(1).max(5000);
const date = z.string().date().transform((value) => new Date(`${value}T00:00:00.000Z`));
// Accept decimal strings without passing through floating-point arithmetic.
const decimal = (scale: number) => z.string().regex(new RegExp(`^\\d{1,12}(\\.\\d{1,${scale}})?$`));
const quantity = z.union([decimal(3), z.number().finite().nonnegative().transform(String).pipe(decimal(3))]);
const item = z.object({
  id: z.string().uuid().optional(), itemSizeId: z.string().uuid(),
  quantityInspection: quantity,
  quantityMaintenance: quantity.default('0'),
}).strict().refine(value => /[1-9]/.test(value.quantityInspection) || /[1-9]/.test(value.quantityMaintenance), 'At least one quantity must be positive');
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
export const updateQuotationSchema = z.object(fields).partial().extend({
  version: z.number().int().nonnegative().max(2147483646),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'version'), 'At least one editable field is required');
export const deactivateQuotationSchema = z.object({ version: z.number().int().nonnegative().max(2147483646) }).strict();
export const approveQuotationSchema = deactivateQuotationSchema;
export type QuotationItemInput = z.infer<typeof item>;
