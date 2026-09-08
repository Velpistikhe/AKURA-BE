import { z } from 'zod';
import { OFFICE_BRANCH_LIST_CONFIG } from '../../../config/list.config.js';
import { createListQueryFields } from '../../../utils/listQuery.js';

const officeFields = {
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(500),
  telp: z.string().trim().min(3).max(30).regex(
    /^[0-9+().\-\s]+$/,
    'Phone number contains invalid characters',
  ),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  isHead: z.boolean().optional().default(false),
};

export const officeBranchIdSchema = z.object({
  officeBranchId: z.string().uuid('Invalid office branch ID'),
}).strict();

export const listOfficeBranchesSchema = z.object({
  ...createListQueryFields(OFFICE_BRANCH_LIST_CONFIG),
  ...OFFICE_BRANCH_LIST_CONFIG.filterFields,
}).strict();

export const createOfficeBranchSchema = z.object(officeFields).strict();

export const updateOfficeBranchSchema = z.object({
  name: officeFields.name.optional(),
  address: officeFields.address.optional(),
  telp: officeFields.telp.optional(),
  email: officeFields.email.optional(),
  isHead: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export type ListOfficeBranchesInput = z.infer<typeof listOfficeBranchesSchema>;
export type CreateOfficeBranchInput = z.infer<typeof createOfficeBranchSchema>;
export type UpdateOfficeBranchInput = z.infer<typeof updateOfficeBranchSchema>;
