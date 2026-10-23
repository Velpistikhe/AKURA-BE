import { z } from 'zod';
import { WorkOrderStatus } from '@prisma/client';
const date = z.string().date().transform(value => new Date(`${value}T00:00:00.000Z`));
const version = z.number().int().min(0).max(2147483646);
const inspectorNames = z.array(z.string().trim().min(1).max(255)).max(100)
  .refine(names => new Set(names.map(name => name.toLowerCase())).size === names.length, 'Inspector names must be unique');
// Create accepts [{ userId, name }] pairs taken from the inspector options
// snapshot; the server re-validates every pair against the branch-scoped
// FieldServiceUser read model and stores the confirmed idUser + name.
const inspectorUsers = z.array(z.object({
  userId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
}).strict()).min(1, 'At least one inspector is required').max(100)
  .refine(rows => new Set(rows.map(({ userId }) => userId.toLowerCase())).size === rows.length, 'Inspector user IDs must be unique');
const fields = {
  contractId: z.string().uuid().nullable().optional(),
  quotationId: z.string().uuid().nullable().optional(),
  performaInvoiceId: z.string().uuid().nullable().optional(),
  startDate: date,
  endDate: date.optional(),
  inspectors: inspectorNames.optional(),
};
type Reference = {
  quotationId?: string | null; contractId?: string | null; performaInvoiceId?: string | null;
};
const validReference = (value: Reference) =>
  Number(!!value.quotationId) + Number(!!value.contractId) + Number(!!value.performaInvoiceId) >= 1;
// Creation always starts at DRAFT; status transitions are edits, never part of create.
// The quotation/contract content is snapshotted by the server, so clients only send IDs.
// Every creation carries the inspector pairs; at least one is required for
// both quotation and contract bases (PATCH keeps the name-based array and []).
export const createWorkOrderSchema = z.object({ ...fields, inspectors: inspectorUsers, items: z.array(z.object({
  itemSizeId: z.string().uuid(),
  snapshotItemSize: z.object({ itemSizeId: z.string().uuid(), snapShotItem: z.unknown(), size: z.unknown() }).passthrough(),
  quantityInspection: z.number().finite().nonnegative(),
  quantityMaintenance: z.number().finite().nonnegative(),
}).strict()).min(1, 'At least one item is required') }).strict()
  .refine(validReference, 'At least one of quotationId, contractId or performaInvoiceId is required')
  .refine(value => !value.quotationId || value.endDate !== undefined,
    'A quotation-based Work order requires quotationId, startDate and endDate');
// The DRAFT -> IN_PROGRESS transition must go through POST /:id/start (which
// re-validates the quotation snapshot against Marketing); PATCH may not set it.
// Other statuses remain simple CRUD labels as before.
export const updateWorkOrderSchema = z.object({ ...fields, endDate: date.nullable().optional(),
  status: z.nativeEnum(WorkOrderStatus).refine(value => value !== 'IN_PROGRESS', 'Use POST /:id/start to move a Work order to IN_PROGRESS').optional() }).partial().extend({ version }).strict()
  .refine(value => !['quotationId','contractId','performaInvoiceId'].some(key => key in value) || validReference(value), 'At least one of quotationId, contractId or performaInvoiceId is required when replacing the document basis')
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
