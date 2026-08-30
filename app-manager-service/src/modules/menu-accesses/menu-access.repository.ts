import { Prisma, UserRole, UserSection } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { buildListQuery, buildPagination, defineSortRules } from '../../utils/listQuery.js';
import { ListMenuAccessesInput } from './menu-access.schemas.js';
import { ManagedMenuAccess, MenuAccessCreate, MenuAccessUpdate, PaginatedMenuAccesses } from './menu-access.types.js';

const menuAccessSelect = {
  id: true,
  menuItemId: true,
  role: true,
  section: true,
  createdAt: true,
  updatedAt: true,
  menuItem: { select: { id: true, key: true, label: true, menuId: true } },
} satisfies Prisma.MenuAccessSelect;

const throwConflict = (error: unknown): never => {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
    throw new HttpError('Menu access rule already exists', 409);
  }
  throw error;
};

class MenuAccessRepository {
  async list(input: ListMenuAccessesInput): Promise<PaginatedMenuAccesses> {
    const query = buildListQuery(input, {
      filters: {
        menuItemId: (menuItemId) => ({ menuItemId }),
        role: (role) => ({ role }),
        section: (section) => ({ section }),
      },
      defaultSort: { createdAt: 'desc' },
      sorts: defineSortRules<NonNullable<ListMenuAccessesInput['sortBy']>, Prisma.MenuAccessOrderByWithRelationInput>({
        menuItemId: (direction) => ({ menuItemId: direction }),
        role: (direction) => ({ role: direction }),
        section: (direction) => ({ section: direction }),
        updatedAt: (direction) => ({ updatedAt: direction }),
      }),
    });
    const [menuAccesses, total] = await Promise.all([
      prisma.menuAccess.findMany({ ...query, select: menuAccessSelect }),
      prisma.menuAccess.count({ where: query.where }),
    ]);
    return { menuAccesses, pagination: buildPagination(input.page, input.limit, total) };
  }

  findById(id: string): Promise<ManagedMenuAccess | null> {
    return prisma.menuAccess.findUnique({ where: { id }, select: menuAccessSelect });
  }

  findByRule(menuItemId: string, role: UserRole | null, section: UserSection | null, excludeId?: string): Promise<ManagedMenuAccess | null> {
    return prisma.menuAccess.findFirst({
      where: { menuItemId, role, section, ...(excludeId && { id: { not: excludeId } }) },
      select: menuAccessSelect,
    });
  }

  async create(data: MenuAccessCreate): Promise<ManagedMenuAccess> {
    try {
      return await prisma.menuAccess.create({ data, select: menuAccessSelect });
    } catch (error) {
      return throwConflict(error);
    }
  }

  async update(id: string, data: MenuAccessUpdate): Promise<ManagedMenuAccess> {
    try {
      return await prisma.menuAccess.update({ where: { id }, data, select: menuAccessSelect });
    } catch (error) {
      return throwConflict(error);
    }
  }

  delete(id: string): Promise<ManagedMenuAccess> {
    return prisma.menuAccess.delete({ where: { id }, select: menuAccessSelect });
  }
}

export const menuAccessRepository = new MenuAccessRepository();
