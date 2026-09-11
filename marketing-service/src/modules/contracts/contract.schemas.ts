import { z } from 'zod';
import { versionSchema } from '../items/item.schemas.js';
export const contractStatusSchema = z.enum(['CREATE', 'ACTIVE', 'EXPIRED', 'TERMINATED']);
const dates = {
  effectiveFrom: z.string().datetime({ offset: true }).transform(value => new Date(value)),
  effectiveUntil: z.string().datetime({ offset: true }).transform(value => new Date(value)).nullable(),
};
const validPeriod = (value: { effectiveFrom: Date; effectiveUntil: Date | null }) => value.effectiveUntil === null || value.effectiveUntil > value.effectiveFrom;
export const createContractSchema = z.object({ companyId: z.string().uuid(), status: contractStatusSchema.default('CREATE'), ...dates }).strict().refine(validPeriod, 'effectiveUntil must be after effectiveFrom');
export const updateContractSchema = versionSchema.extend({ status: contractStatusSchema.optional(), effectiveFrom: dates.effectiveFrom.optional(), effectiveUntil: dates.effectiveUntil.optional() })
  .refine(value => value.status !== undefined || value.effectiveFrom !== undefined || value.effectiveUntil !== undefined, 'Provide status or contract dates');
export const contractIdSchema = z.object({ contractId: z.string().uuid() }).strict();
export const listContractsSchema = z.object({
  companyId: z.string().uuid(), page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  isActive: z.enum(['true', 'false']).transform(value => value === 'true').optional(),
  status: contractStatusSchema.optional(),
}).strict();
export type ContractPeriod = z.infer<typeof updateContractSchema>;
export type CreateContractInput = z.infer<typeof createContractSchema>;
export type ListContractsInput = z.infer<typeof listContractsSchema>;
