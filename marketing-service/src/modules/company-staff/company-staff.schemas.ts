import { StaffTitle } from '@prisma/client';
import { z } from 'zod';
import { createListQueryFields } from '../../utils/listQuery.js';

export const COMPANY_STAFF_SORT_FIELDS = ['companyId', 'name', 'title', 'version', 'updatedAt'] as const;

export const companyStaffIdSchema = z.object({ companyStaffId: z.string().uuid() });
export const listCompanyStaffSchema = z.object({
  ...createListQueryFields(COMPANY_STAFF_SORT_FIELDS),
  companyId: z.string().uuid().optional(),
  search: z.string().trim().min(1).max(100).optional(),
  title: z.nativeEnum(StaffTitle).optional(),
}).strict();
export const createCompanyStaffSchema = z.object({
  companyId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  title: z.nativeEnum(StaffTitle),
  telp: z.string().trim().min(1).max(30).nullable().optional().default(null),
  email: z.string().trim().email().max(254).nullable().optional().default(null),
}).strict();
export const updateCompanyStaffSchema = z.object({
  companyId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(200).optional(),
  title: z.nativeEnum(StaffTitle).optional(),
  telp: z.string().trim().min(1).max(30).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export type ListCompanyStaffInput = z.infer<typeof listCompanyStaffSchema>;
export type CreateCompanyStaffInput = z.infer<typeof createCompanyStaffSchema>;
export type UpdateCompanyStaffInput = z.infer<typeof updateCompanyStaffSchema>;
