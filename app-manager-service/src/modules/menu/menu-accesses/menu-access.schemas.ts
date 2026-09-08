import { UserRole, UserSection } from '@prisma/client';
import { z } from 'zod';
import { MENU_ACCESS_LIST_CONFIG } from '../../../config/list.config.js';
import { createListQueryFields } from '../../../utils/listQuery.js';

export const menuAccessIdSchema = z.object({
  menuAccessId: z.string().uuid('Invalid menu access ID'),
}).strict();

export const listMenuAccessesSchema = z.object({
  ...createListQueryFields(MENU_ACCESS_LIST_CONFIG),
  ...MENU_ACCESS_LIST_CONFIG.filterFields,
}).strict();

export const createMenuAccessSchema = z.object({
  menuItemId: z.string().uuid('Invalid menu item ID'),
  role: z.nativeEnum(UserRole).nullable().optional().default(null),
  section: z.nativeEnum(UserSection).nullable().optional().default(null),
}).strict();

export const updateMenuAccessSchema = z.object({
  menuItemId: z.string().uuid('Invalid menu item ID').optional(),
  role: z.nativeEnum(UserRole).nullable().optional(),
  section: z.nativeEnum(UserSection).nullable().optional(),
}).strict().refine((data) => Object.keys(data).length > 0, 'At least one field is required');

export type ListMenuAccessesInput = z.infer<typeof listMenuAccessesSchema>;
export type CreateMenuAccessInput = z.infer<typeof createMenuAccessSchema>;
export type UpdateMenuAccessInput = z.infer<typeof updateMenuAccessSchema>;
