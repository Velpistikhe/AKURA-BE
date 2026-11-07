import { z } from 'zod';
import { WorkOrderStatus } from '@prisma/client';
const date = z.string().date().transform(value => new Date(`${value}T00:00:00.000Z`));
const version = z.number().int().min(0).max(2147483646);
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
type Reference = {
  quotationId?: string | null; contractId?: string | null;
};
const validReference = (value: Reference) =>
  Number(!!value.quotationId) + Number(!!value.contractId) >= 1;
// Creation always starts at DRAFT; status transitions are edits, never part of create.
// The quotation/contract content is snapshotted by the server, so clients only send IDs.
// Every creation carries the inspector names; at least one is required for
// both quotation and contract bases (PATCH keeps the same array and []).
export const createWorkOrderSchema = z.object({ ...fields, inspectors: inspectorNameList.min(1, 'At least one inspector is required').refine(uniqueInspectorNames, 'Inspector names must be unique'), items: z.array(z.object({
  itemSizeId: z.string().uuid(),
  quantityInspection: quantity,
  quantityMaintenance: quantity,
}).strict()).min(1, 'At least one item is required') }).strict()
  .refine(validReference, 'At least one of quotationId or contractId is required')
  .refine(value => !value.quotationId || value.endDate !== undefined,
    'A quotation-based Work order requires quotationId, startDate and endDate');
// The DRAFT -> IN_PROGRESS transition must go through POST /:id/start (which
// re-validates the quotation snapshot against Marketing); PATCH may not set it.
// Other statuses remain simple CRUD labels as before.
export const updateWorkOrderSchema = z.object({ ...fields, endDate: date.nullable().optional(),
  status: z.nativeEnum(WorkOrderStatus).refine(value => value !== 'IN_PROGRESS', 'Use POST /:id/start to move a Work order to IN_PROGRESS').optional() }).partial().extend({ version }).strict()
  .refine(value => !['quotationId','contractId'].some(key => key in value) || validReference(value), 'At least one of quotationId or contractId is required when replacing the document basis')
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
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>;

export const workOrderHistorySchema = listWorkOrderSchema.pick({ page: true, limit: true });

