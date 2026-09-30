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
  branch: z.string().trim().min(1).max(200).nullable().optional(),
  email: z.string().trim().email('Invalid email address').max(255).transform(value => value.toLowerCase()).nullable().optional(),
  telp: z.string().trim().min(1).max(50).nullable().optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
}).strict().refine(
  ({ version: _version, ...fields }) => Object.keys(fields).length > 0,
  'At least one user field is required',
).superRefine((value, context) => {
  // officeBranchId and branch always travel as an explicit pair so the stored
  // branch id and its display name can never drift apart.
  if ((value.officeBranchId === undefined) !== (value.branch === undefined)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['branch'],
      message: 'officeBranchId and branch must be sent together',
    });
    return;
  }
  if (value.officeBranchId === null && value.branch !== null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['branch'],
      message: 'branch must be null when officeBranchId is cleared',
    });
  }
  if (value.officeBranchId !== undefined && value.officeBranchId !== null && value.branch === null) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['branch'],
      message: 'branch name is required when officeBranchId is set',
    });
  }
});

export type ListUsersInput = z.infer<typeof listUsersSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
