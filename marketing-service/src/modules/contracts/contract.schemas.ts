import { z } from 'zod';
import { versionSchema } from '../items/item.schemas.js';
export const contractStatusSchema = z.enum(['DRAFT', 'SUBMITTED', 'REJECTED', 'APPROVED', 'TERMINATED', 'REVISED']);
const dates = {
  effectiveFrom: z.string().date().transform(value => new Date(`${value}T00:00:00.000Z`)),
  effectiveUntil: z.string().date().transform(value => new Date(`${value}T00:00:00.000Z`)),
};
const contractDate = z.string().date().transform(value => new Date(`${value}T00:00:00.000Z`));
const validPeriod = (value: { effectiveFrom: Date; effectiveUntil: Date }) => value.effectiveUntil >= value.effectiveFrom;
const validContractDate = (value: { contractDate?: Date; effectiveFrom: Date }) => !value.contractDate || value.contractDate <= value.effectiveFrom;
const contractDateMessage = 'contractDate must be on or before effectiveFrom';
export const createContractSchema = z.object({
  companyId: z.string().uuid(), contractNumber: z.string().trim().min(1).max(255), contractDate,
  ...dates,
}).strict()
  .refine(validPeriod, 'effectiveUntil must be after effectiveFrom')
  .refine(validContractDate, contractDateMessage);
const contractChangeSchema = versionSchema.extend({
  contractNumber: z.string().trim().min(1).max(255), contractDate,
  ...dates,
}).strict()
  .refine(validPeriod, 'effectiveUntil must be after effectiveFrom')
  .refine(validContractDate, contractDateMessage);
export const updateContractSchema = contractChangeSchema;
export const reviseContractSchema = contractChangeSchema;
export const terminateContractSchema = versionSchema.extend({ terminatedAt: z.string().date().transform(value => new Date(`${value}T00:00:00.000Z`)) }).strict();
export const contractIdSchema = z.object({ contractId: z.string().uuid() }).strict();
export const listContractsSchema = z.object({
  companyId: z.string().uuid().optional(), page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: contractStatusSchema.optional(),
}).strict();
export type ContractPeriod = z.infer<typeof updateContractSchema>;
export type CreateContractInput = z.infer<typeof createContractSchema>;
export type ListContractsInput = z.infer<typeof listContractsSchema>;
