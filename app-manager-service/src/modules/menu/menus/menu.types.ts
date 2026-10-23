import { Menu } from '@prisma/client';

export type ManagedMenu = Pick<Menu, 'id' | 'key' | 'label' | 'hasItem' | 'order' | 'isActive' | 'isDeleted' | 'createdAt' | 'updatedAt'>;

export interface PaginatedMenus {
  menus: ManagedMenu[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export type MenuUpdate = {
  key?: string;
  label?: string;
  hasItem?: boolean;
  order?: number;
  isActive?: boolean;
};

export interface UserMenuItemResponse {
  key: string;
  label: string;
  order: number;
}

export interface UserMenuResponse {
  key: string;
  label: string;
  hasItem: boolean;
  order: number;
  items: UserMenuItemResponse[];
}

export type MenusForUserResult = UserMenuResponse[];
