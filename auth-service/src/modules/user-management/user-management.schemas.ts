import { UserRole, UserSection } from '@prisma/client';
import { z } from 'zod';
import { USER_LIST_CONFIG } from '../../config/list.config.js';
import { createListQueryFields } from '../../utils/listQuery.js';

export const userIdSchema = z.object({ userId: z.string().uuid('Invalid user ID') });
export const listUsersSchema = z.object({
  ...createListQueryFields(USER_LIST_CONFIG),
  ...USER_LIST_CONFIG.filterFields,
}).strict();
export const updateUserSchema = z.object({
  role: z.nativeEnum(UserRole).optional(),
  section: z.nativeEnum(UserSection).nullable().optional(),
  officeBranchId: z.string().uuid('Invalid office branch ID').nullable().optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
}).strict().refine(
  ({ version: _version, ...fields }) => Object.keys(fields).length > 0,
  'At least one user field is required',
);

export type ListUsersInput = z.infer<typeof listUsersSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
