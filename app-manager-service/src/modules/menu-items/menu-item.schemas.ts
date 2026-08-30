import { UserRole, UserSection } from '@prisma/client';
import { z } from 'zod';
import { createListQueryFields } from '../../utils/listQuery.js';

export const MENU_ITEM_SORT_FIELDS = ['menuId', 'key', 'label', 'path', 'order', 'isActive', 'updatedAt'] as const;

export const menuItemIdSchema = z.object({
  menuItemId: z.string().uuid('Invalid menu item ID'),
});

export const listMenuItemsSchema = z.object({
  ...createListQueryFields(MENU_ITEM_SORT_FIELDS, { limit: 50 }),
  menuId: z.string().uuid().optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  search: z.string().trim().min(1).max(100).optional(),
}).strict();

const legacyMenuItemAccessFields = {
  role: z.nativeEnum(UserRole).nullable().optional(),
  section: z.nativeEnum(UserSection).nullable().optional(),
};

export const createMenuItemSchema = z.object({
  menuId: z.string().uuid('Invalid menu ID'),
  key: z.string().trim().min(1).max(100).regex(
    /^[a-z0-9_-]+$/,
    'Key can only contain lowercase alphanumeric characters, underscores, and hyphens'
  ),
  label: z.string().trim().min(1).max(200),
  path: z.string().trim().min(1).max(500),
  order: z.number().int().min(0).optional().default(0),
  ...legacyMenuItemAccessFields,
}).strict().transform(({ role: _role, section: _section, ...item }) => item);

export const updateMenuItemSchema = z.object({
  menuId: z.string().uuid().optional(),
  key: z.string().trim().min(1).max(100).regex(/^[a-z0-9_-]+$/).optional(),
  label: z.string().trim().min(1).max(200).optional(),
  path: z.string().trim().min(1).max(500).optional(),
  order: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  ...legacyMenuItemAccessFields,
}).strict().transform(({ role: _role, section: _section, ...item }) => item);

export type ListMenuItemsInput = z.infer<typeof listMenuItemsSchema>;
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;
