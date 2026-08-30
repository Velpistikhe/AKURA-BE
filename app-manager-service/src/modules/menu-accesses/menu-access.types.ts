import { MenuAccess, UserRole, UserSection } from '@prisma/client';

export type ManagedMenuAccess = Pick<
  MenuAccess,
  'id' | 'menuItemId' | 'role' | 'section' | 'createdAt' | 'updatedAt'
> & {
  menuItem: { id: string; key: string; label: string; menuId: string };
};

export interface PaginatedMenuAccesses {
  menuAccesses: ManagedMenuAccess[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export type MenuAccessCreate = {
  menuItemId: string;
  role: UserRole | null;
  section: UserSection | null;
};

export type MenuAccessUpdate = Partial<MenuAccessCreate>;
