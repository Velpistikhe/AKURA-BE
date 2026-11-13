import { z } from 'zod';
import { WorkOrderStatus } from '@prisma/client';
const date = z.string().date().transform(value => new Date(`${value}T00:00:00.000Z`));
const version = z.number().int().min(0).max(2147483646);
// The end date must not precede the start date. The same day is allowed, so a
// one-day Work Order keeps the same start and end date.
const END_DATE_BEFORE_START = 'End date cannot precede start date';
// Both dates are already normalised to UTC midnight, so a plain comparison is
// an exact calendar-day comparison.
const endDateNotBeforeStart = (value: { startDate?: Date; endDate?: Date | null }) =>
  value.startDate === undefined || value.endDate === undefined || value.endDate === null
  || value.endDate.getTime() >= value.startDate.getTime();
// Matches PostgreSQL Decimal(15,3), avoiding implicit rounding or database errors.
const quantity = z.number().finite().nonnegative().max(999999999999.999)
  .refine(value => /^\d{1,12}(\.\d{1,3})?$/.test(String(value)), 'Quantity must have at most three decimal places');
// Inspector names are the inspector identity: the display name (firstName +
// lastName) is the only reference a Work Order keeps. Case-insensitive
// duplicates are rejected so the same person cannot be booked twice.
const inspectorNameList = z.array(z.string().trim().min(1).max(255)).max(100);
const uniqueInspectorNames = (names: string[]) =>
  new Set(names.map(name => name.toLowerCase())).size === names.length;
const inspectorNames = inspectorNameList
  .refine(uniqueInspectorNames, 'Inspector names must be unique');
const fields = {
  contractId: z.string().uuid().nullable().optional(),
  quotationId: z.string().uuid().nullable().optional(),
  startDate: date,
  endDate: date.optional(),
  // PATCH replaces the full list, so an empty array clears the inspectors.
  inspectors: inspectorNames.optional(),
};
const createItemRows = z.array(z.object({
  itemSizeId: z.string().uuid(),
  quantityInspection: quantity,
  quantityMaintenance: quantity,
}).strict()).min(1, 'At least one item is required');
const createInspectors = inspectorNameList
  .min(1, 'At least one inspector is required')
  .refine(uniqueInspectorNames, 'Inspector names must be unique');
const workOrderHeaderRequired = {
  companyId: z.string().uuid(),
  subject: z.string().trim().min(1).max(255),
  officialReport: z.boolean(),
  dailyReport: date,
  officialReportDelivery: date,
  dailyReportDelivery: date,
  poNumber: z.string().trim().min(1).max(100),
  poDate: date,
};
const quotationHeaderOptional = {
  subject: z.string().trim().min(1).max(255).optional(),
  officialReport: z.boolean().optional(),
  dailyReport: date.optional(),
  officialReportDelivery: date.optional(),
  dailyReportDelivery: date.optional(),
  poNumber: z.string().trim().min(1).max(100).optional(),
  poDate: date.optional(),
};
type Reference = {
  quotationId?: string | null; contractId?: string | null;
};
const validReference = (value: Reference) =>
  Number(!!value.quotationId) + Number(!!value.contractId) >= 1;
/** POST /work-orders — company basis; companyId is validated live against Marketing. */
export const createWorkOrderByCompanySchema = z.object({
  ...workOrderHeaderRequired,
  contractId: z.string().uuid().nullable().optional(),
  startDate: date,
  endDate: date.optional(),
  inspectors: createInspectors,
  items: createItemRows,
}).strict()
  .refine(endDateNotBeforeStart, { message: END_DATE_BEFORE_START, path: ['endDate'] });
/** POST /work-orders/from-quotation — quotation basis; companyId is taken from the quotation snapshot only. */
export const createWorkOrderByQuotationSchema = z.object({
  quotationId: z.string().uuid(),
  startDate: date,
  endDate: date,
  ...quotationHeaderOptional,
  inspectors: createInspectors,
  items: createItemRows,
}).strict()
  .refine(endDateNotBeforeStart, { message: END_DATE_BEFORE_START, path: ['endDate'] });
// The DRAFT -> IN_PROGRESS transition must go through POST /:id/start (which
// re-validates the quotation snapshot against Marketing); PATCH may not set it.
// Other statuses remain simple CRUD labels as before.
export const updateWorkOrderSchema = z.object({ ...fields, endDate: date.nullable().optional(),
  status: z.nativeEnum(WorkOrderStatus).refine(value => value !== 'IN_PROGRESS', 'Use POST /:id/start to move a Work order to IN_PROGRESS').optional() }).partial().extend({ version }).strict()
  .refine(value => !['quotationId','contractId'].some(key => key in value) || validReference(value), 'At least one of quotationId or contractId is required when replacing the document basis')
  // A PATCH that submits both dates is checked here. When only one date is
  // submitted the effective pair is only known against the stored Work Order,
  // so the repository compares it with the current row inside the transaction.
  .refine(endDateNotBeforeStart, { message: END_DATE_BEFORE_START, path: ['endDate'] })
  .refine(value => Object.keys(value).some(key => key !== 'version'), 'At least one editable field is required');
export const deleteWorkOrderSchema = z.object({ version }).strict();
// Moving DRAFT -> IN_PROGRESS requires live Marketing validation, so it only
// happens through POST /:id/start; this schema carries the optimistic-lock version.
export const startWorkOrderSchema = z.object({ version }).strict();
export const workOrderIdSchema = z.string().uuid();
export const listWorkOrderSchema = z.object({
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(WorkOrderStatus).optional(),
  quotationId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  revoked: z.enum(['true', 'false']).transform(value => value === 'true').default('false'),
  search: z.string().trim().max(100).optional(),
}).strict();
export type CreateWorkOrderByCompanyInput = z.infer<typeof createWorkOrderByCompanySchema>;
export type CreateWorkOrderByQuotationInput = z.infer<typeof createWorkOrderByQuotationSchema>;
export type CreateWorkOrderInput = CreateWorkOrderByCompanyInput | CreateWorkOrderByQuotationInput;
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>;

export const workOrderHistorySchema = listWorkOrderSchema.pick({ page: true, limit: true });

