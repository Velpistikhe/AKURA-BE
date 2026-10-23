import { MenuItem } from '@prisma/client';

export type ManagedMenuItem = Pick<
  MenuItem,
  'id' | 'menuId' | 'key' | 'label' | 'order' | 'isActive' | 'isDeleted' | 'createdAt' | 'updatedAt'
>;

export interface PaginatedMenuItems {
  items: ManagedMenuItem[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export type MenuItemCreate = {
  menuId: string;
  key: string;
  label: string;
  order: number;
};

export type MenuItemUpdate = {
  menuId?: string;
  key?: string;
  label?: string;
  order?: number;
  isActive?: boolean;
};
