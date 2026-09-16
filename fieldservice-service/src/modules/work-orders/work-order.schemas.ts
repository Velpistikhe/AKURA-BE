import { z } from 'zod';
import { WorkOrderStatus } from '@prisma/client';
const date = z.string().date().transform(value => new Date(`${value}T00:00:00.000Z`));
const version = z.number().int().min(0).max(2147483646);
const inspectors = z.array(z.string().trim().min(1).max(255)).max(100)
  .refine(names => new Set(names.map(name => name.toLowerCase())).size === names.length, 'Inspector names must be unique');
const fields = {
  companyId: z.string().uuid().nullable().optional(),
  quotationId: z.string().uuid().nullable().optional(),
  quotationVersion: version.nullable().optional(),
  startDate: date, endDate: date.nullable().optional(),
  status: z.nativeEnum(WorkOrderStatus).optional(),
  summary: z.string().trim().min(1).max(20000),
  inspectors: inspectors.optional(),
};
type Reference = { quotationId?: string | null; quotationVersion?: number | null; companyId?: string | null };
const validReference = (value: Reference) =>
  (value.quotationId ? value.quotationVersion != null : value.quotationVersion == null)
  && Number(!!value.quotationId) + Number(!!value.companyId) === 1;
export const createWorkOrderSchema = z.object(fields).strict().refine(validReference, 'Supply exactly one quotation/version or companyId');
export const updateWorkOrderSchema = z.object(fields).partial().extend({ version }).strict()
  .refine(value => !['quotationId','quotationVersion','companyId'].some(key => key in value) || validReference(value), 'Supply exactly one quotation/version or companyId when replacing the document basis')
  .refine(value => Object.keys(value).some(key => key !== 'version'), 'At least one editable field is required');
export const deleteWorkOrderSchema = z.object({ version }).strict();
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
