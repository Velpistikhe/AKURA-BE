import { z } from 'zod';
import { MENU_ITEM_LIST_CONFIG } from '../../config/list.config.js';
import { createListQueryFields } from '../../utils/listQuery.js';

export const menuItemIdSchema = z.object({
  menuItemId: z.string().uuid('Invalid menu item ID'),
});

export const listMenuItemsSchema = z.object({
  ...createListQueryFields(MENU_ITEM_LIST_CONFIG),
  ...MENU_ITEM_LIST_CONFIG.filterFields,
}).strict();

export const createMenuItemSchema = z.object({
  menuId: z.string().uuid('Invalid menu ID'),
  key: z.string().trim().min(1).max(100).regex(
    /^[a-z0-9_-]+$/,
    'Key can only contain lowercase alphanumeric characters, underscores, and hyphens'
  ),
  label: z.string().trim().min(1).max(200),
  path: z.string().trim().min(1).max(500),
  order: z.number().int().min(0).optional().default(0),
}).strict();

export const updateMenuItemSchema = z.object({
  menuId: z.string().uuid().optional(),
  key: z.string().trim().min(1).max(100).regex(/^[a-z0-9_-]+$/).optional(),
  label: z.string().trim().min(1).max(200).optional(),
  path: z.string().trim().min(1).max(500).optional(),
  order: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
}).strict();

export type ListMenuItemsInput = z.infer<typeof listMenuItemsSchema>;
export type CreateMenuItemInput = z.infer<typeof createMenuItemSchema>;
export type UpdateMenuItemInput = z.infer<typeof updateMenuItemSchema>;
