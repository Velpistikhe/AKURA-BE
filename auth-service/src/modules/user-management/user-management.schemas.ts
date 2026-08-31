import { UserRole, UserSection } from '@prisma/client';
import { z } from 'zod';
import { USER_LIST_CONFIG } from '../../config/list.config.js';
import { createListQueryFields } from '../../utils/listQuery.js';

export const userIdSchema = z.object({ userId: z.string().uuid('Invalid user ID') });
export const listUsersSchema = z.object({
  ...createListQueryFields(USER_LIST_CONFIG),
  ...USER_LIST_CONFIG.filterFields,
}).strict();
export const setRoleSchema = z.object({ role: z.nativeEnum(UserRole), version: z.number().int().positive() });
export const setSectionSchema = z.object({ section: z.nativeEnum(UserSection).nullable(), version: z.number().int().positive() });
export const setStatusSchema = z.object({ isActive: z.boolean(), version: z.number().int().positive() });

export type ListUsersInput = z.infer<typeof listUsersSchema>;
export type SetRoleInput = z.infer<typeof setRoleSchema>;
export type SetSectionInput = z.infer<typeof setSectionSchema>;
export type SetStatusInput = z.infer<typeof setStatusSchema>;
