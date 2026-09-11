import { z } from 'zod';
import { InquiryMethod, QuotationStatus, InvoiceStatus } from '@prisma/client';

export const quotationIdSchema = z.object({ quotationId: z.string().uuid() }).strict();
export const listQuotationsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();
export type ListQuotationsInput = z.infer<typeof listQuotationsSchema>;

const text = z.string().trim().min(1).max(255);
const date = z.string().date().transform((value) => new Date(`${value}T00:00:00.000Z`));
// Accept decimal strings without passing through floating-point arithmetic.
const decimal = (scale: number) => z.string().regex(new RegExp(`^\\d{1,12}(\\.\\d{1,${scale}})?$`));
const item = z.object({
  id: z.string().uuid().optional(),
  itemSizeId: z.string().uuid(),
  quantity: decimal(3).refine((value) => /[1-9]/.test(value), 'Quantity must be positive'),
  unitPrice: decimal(2),
}).strict();
const items = z.array(item).min(1).max(100).refine((rows) => {
  const ids = rows.flatMap((row) => row.id ? [row.id] : []);
  return ids.length === new Set(ids).size;
}, 'Item IDs must be unique');
const fields = {
  date: date.nullable().optional(),
  inquiryMethod: z.nativeEnum(InquiryMethod),
  inquiryDate: date,
  subject: text, termOfPayment: text, validity: text,
  tax: z.number().int().min(0).max(100),
  supplyAkura: text, supplyCustomer: text, location: text,
  accomplished: text, deliveryReports: text,
  staffId: z.string().uuid(),
  status: z.nativeEnum(QuotationStatus).optional(),
  invoiceStatus: z.nativeEnum(InvoiceStatus).nullable().optional(),
  items,
};
export const createQuotationSchema = z.object(fields).strict()
  .refine((value) => value.items.every((row) => !row.id), 'New quotation items cannot supply IDs');
export const updateQuotationSchema = z.object(fields).partial().extend({
  version: z.number().int().nonnegative().max(2147483646),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'version'), 'At least one editable field is required');
export const deactivateQuotationSchema = z.object({ version: z.number().int().nonnegative().max(2147483646) }).strict();
export type QuotationItemInput = z.infer<typeof item>;
