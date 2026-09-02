import { z } from 'zod';
import { MENU_LIST_CONFIG } from '../../config/list.config.js';
import { createListQueryFields } from '../../utils/listQuery.js';

export const menuIdSchema = z.object({
  menuId: z.string().uuid('Invalid menu ID'),
});

export const listMenusSchema = z.object({
  ...createListQueryFields(MENU_LIST_CONFIG),
  ...MENU_LIST_CONFIG.filterFields,
}).strict();

const menuFields = {
  key: z.string().trim().min(1).max(100).regex(
    /^[a-z0-9_-]+$/,
    'Key can only contain lowercase alphanumeric characters, underscores, and hyphens'
  ),
  label: z.string().trim().min(1).max(200),
  order: z.number().int().min(0).optional().default(0),
};

const nestedMenuItemSchema = z.object({
  key: z.string().trim().min(1).max(100).regex(
    /^[a-z0-9_-]+$/,
    'Key can only contain lowercase alphanumeric characters, underscores, and hyphens'
  ),
  label: z.string().trim().min(1).max(200),
  order: z.number().int().min(0).optional().default(0),
}).strict();

export const createMenuSchema = z.discriminatedUnion('hasItem', [
  z.object({
    ...menuFields,
    hasItem: z.literal(true),
    items: z.array(nestedMenuItemSchema).min(1).max(100)
      .refine((items) => new Set(items.map(({ key }) => key)).size === items.length, 'Menu item keys must be unique'),
  }).strict(),
  z.object({
    ...menuFields,
    hasItem: z.literal(false),
  }).strict(),
]);

export const updateMenuSchema = z.object({
  key: z.string().trim().min(1).max(100).regex(/^[a-z0-9_-]+$/).optional(),
  label: z.string().trim().min(1).max(200).optional(),
  hasItem: z.boolean().optional(),
  order: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
}).strict();

export type ListMenusInput = z.infer<typeof listMenusSchema>;
export type CreateMenuInput = z.infer<typeof createMenuSchema>;
export type UpdateMenuInput = z.infer<typeof updateMenuSchema>;
export type MenuIdParams = z.infer<typeof menuIdSchema>;
