import { z } from 'zod';
import { createListQueryFields } from '../../utils/listQuery.js';

export const COMPANY_SORT_FIELDS = ['name', 'type', 'address', 'hasContract', 'version', 'updatedAt'] as const;

const fields = {
  name: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(100),
  address: z.string().trim().min(1).max(500),
};

export const companyIdSchema = z.object({ companyId: z.string().uuid() });
export const listCompaniesSchema = z.object({
  ...createListQueryFields(COMPANY_SORT_FIELDS),
  search: z.string().trim().min(1).max(100).optional(),
  hasContract: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
}).strict();
export const createCompanySchema = z.object({ ...fields, hasContract: z.boolean().optional().default(false) }).strict();
export const updateCompanySchema = z.object({
  name: fields.name.optional(), type: fields.type.optional(), address: fields.address.optional(), hasContract: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export type ListCompaniesInput = z.infer<typeof listCompaniesSchema>;
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
