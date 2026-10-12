import { UserRole, UserSection } from '@prisma/client';
import { z } from 'zod';
import { USER_LIST_CONFIG } from '../../config/list.config.js';
import { createListQueryFields } from '../../utils/listQuery.js';

export const userIdSchema = z.object({ userId: z.string().uuid('Invalid user ID') });
export const listUsersSchema = z.object({
  ...createListQueryFields(USER_LIST_CONFIG),
  ...USER_LIST_CONFIG.filterFields,
}).strict();

// Read-only monitoring query for the user-sync outbox. Access is restricted to
// APP_MANAGER by the route middleware; section/branch are intentionally not
// part of the contract because sync state is global across branches.
export const USER_SYNC_TARGET_SERVICES = ['marketing-service', 'fieldservice-service'] as const;
export const listUserSyncDeliveriesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['pending', 'delivered']).optional(),
  targetService: z.enum(USER_SYNC_TARGET_SERVICES).optional(),
  userId: z.string().uuid('Invalid user ID').optional(),
}).strict();

// Batch inspector validation query for Field Service work-order creation:
// comma-separated user IDs, 1 to 100 entries, unique UUIDs.
export const inspectUsersQuerySchema = z.object({
  ids: z.string().trim().min(1).max(4100)
    .transform(value => value.split(','))
    .pipe(z.array(z.string().uuid('Invalid user ID')).min(1).max(100))
    .refine(ids => new Set(ids).size === ids.length, 'Inspector IDs must be unique'),
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
export type ListUserSyncDeliveriesInput = z.infer<typeof listUserSyncDeliveriesSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
