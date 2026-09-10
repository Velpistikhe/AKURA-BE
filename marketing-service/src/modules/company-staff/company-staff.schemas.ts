import { StaffTitle } from '@prisma/client';
import { z } from 'zod';
import { COMPANY_STAFF_LIST_CONFIG } from '../../config/list.config.js';
import { createListQueryFields } from '../../utils/listQuery.js';

export const companyStaffIdSchema = z.object({ companyStaffId: z.string().uuid() });
export const listCompanyStaffSchema = z.object({
  ...createListQueryFields(COMPANY_STAFF_LIST_CONFIG),
  ...COMPANY_STAFF_LIST_CONFIG.filterFields,
}).strict();
export const createCompanyStaffSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  title: z.nativeEnum(StaffTitle),
  telp: z.string().trim().min(1).max(30).nullable().optional().default(null),
  email: z.string().trim().email().max(254).nullable().optional().default(null),
}).strict();
export const updateCompanyStaffSchema = z.object({
  version: z.number().int().nonnegative(),
  companyId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  title: z.nativeEnum(StaffTitle).optional(),
  telp: z.string().trim().min(1).max(30).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'version'), 'At least one editable field is required');

export const deactivateCompanyStaffSchema = z.object({ version: z.number().int().nonnegative() }).strict();

export type ListCompanyStaffInput = z.infer<typeof listCompanyStaffSchema>;
export type CreateCompanyStaffInput = z.infer<typeof createCompanyStaffSchema>;
export type UpdateCompanyStaffInput = z.infer<typeof updateCompanyStaffSchema>;
