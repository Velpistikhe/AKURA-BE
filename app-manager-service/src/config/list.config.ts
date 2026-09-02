import { UserRole, UserSection } from '@prisma/client';
import { z } from 'zod';

const pagination = (defaultLimit = 20) => ({
  defaultPage: 1,
  defaultLimit,
  maxLimit: 100,
} as const);

const booleanFilter = z.enum(['true', 'false']).transform((value) => value === 'true').optional();
const searchFilter = z.string().trim().min(1).max(100).optional();

export const MENU_LIST_CONFIG = {
  sortFields: ['key', 'label', 'hasItem', 'order', 'isActive', 'updatedAt'],
  filterFields: {
    search: searchFilter,
    hasItem: booleanFilter,
    isActive: booleanFilter,
  },
  pagination: pagination(),
} as const;

export const MENU_ACCESS_LIST_CONFIG = {
  sortFields: ['menuItemId', 'role', 'section', 'updatedAt'],
  filterFields: {
    menuItemId: z.string().uuid('Invalid menu item ID').optional(),
    role: z.nativeEnum(UserRole).optional(),
    section: z.nativeEnum(UserSection).optional(),
  },
  pagination: pagination(),
} as const;

export const MENU_ITEM_LIST_CONFIG = {
  sortFields: ['menuId', 'key', 'label', 'order', 'isActive', 'updatedAt'],
  filterFields: {
    menuId: z.string().uuid('Invalid menu ID').optional(),
    isActive: booleanFilter,
    search: searchFilter,
  },
  pagination: pagination(50),
} as const;
