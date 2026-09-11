import { z } from 'zod';
import { CompanyType } from '@prisma/client';
import { COMPANY_LIST_CONFIG } from '../../config/list.config.js';
import { createListQueryFields } from '../../utils/listQuery.js';

const fields = {
  npwp: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(200),
  type: z.nativeEnum(CompanyType),
  address: z.string().trim().min(1).max(500),
};

export const companyIdSchema = z.object({ companyId: z.string().uuid() });
export const listCompaniesSchema = z.object({
  ...createListQueryFields(COMPANY_LIST_CONFIG),
  ...COMPANY_LIST_CONFIG.filterFields,
}).strict();
export const createCompanySchema = z.object({ ...fields, isSisterCompany: z.boolean().optional().default(false) }).strict();
export const updateCompanySchema = z.object({
  version: z.number().int().nonnegative(),
  npwp: fields.npwp.optional(),
  name: fields.name.optional(), type: fields.type.optional(), address: fields.address.optional(), isSisterCompany: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'version'), 'At least one editable field is required');

export const deactivateCompanySchema = z.object({ version: z.number().int().nonnegative() }).strict();
export const companyHistorySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export type ListCompaniesInput = z.infer<typeof listCompaniesSchema>;
export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
