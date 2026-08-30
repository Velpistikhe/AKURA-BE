import { UserRole, UserSection } from '@prisma/client';
import { z } from 'zod';
import { createListQueryFields } from '../../utils/listQuery.js';

export const USER_SORT_FIELDS = ['username', 'firstName', 'lastName', 'role', 'section', 'isActive', 'updatedAt'] as const;

export const userIdSchema = z.object({ userId: z.string().uuid('Invalid user ID') });
export const listUsersSchema = z.object({
  ...createListQueryFields(USER_SORT_FIELDS),
  search: z.string().trim().min(1).max(100).optional(),
  role: z.nativeEnum(UserRole).optional(),
  section: z.nativeEnum(UserSection).optional(),
  isActive: z.enum(['true', 'false']).transform((value) => value === 'true').optional(),
}).strict();
export const setRoleSchema = z.object({ role: z.nativeEnum(UserRole), version: z.number().int().positive() });
export const setSectionSchema = z.object({ section: z.nativeEnum(UserSection).nullable(), version: z.number().int().positive() });
export const setStatusSchema = z.object({ isActive: z.boolean(), version: z.number().int().positive() });

export type ListUsersInput = z.infer<typeof listUsersSchema>;
export type SetRoleInput = z.infer<typeof setRoleSchema>;
export type SetSectionInput = z.infer<typeof setSectionSchema>;
export type SetStatusInput = z.infer<typeof setStatusSchema>;
