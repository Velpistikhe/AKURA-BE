import { menuWrite } from '../menu-write.js';
import { Prisma, UserRole, UserSection } from '@prisma/client';
import { prisma } from '../../../config/db.js';
import { HttpError } from '../../../utils/httpError.js';
import { buildListQuery, buildPagination, defineSortRules } from '../../../utils/listQuery.js';
import { ListMenuAccessesInput } from './menu-access.schemas.js';
import { ManagedMenuAccess, MenuAccessCreate, MenuAccessUpdate, PaginatedMenuAccesses } from './menu-access.types.js';

const menuAccessSelect = {
  isDeleted: true,
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
    const where = {
      AND: [
        { isDeleted: false },
        { menuItem: { isDeleted: false, isActive: true } },
        { menuItem: { menu: { isActive: true, isDeleted: false } } },
        query.where,
      ],
    } satisfies Prisma.MenuAccessWhereInput;
    const [menuAccesses, total] = await Promise.all([
      prisma.menuAccess.findMany({ ...query, where, select: menuAccessSelect }),
      prisma.menuAccess.count({ where }),
    ]);
    return { menuAccesses, pagination: buildPagination(input.page, input.limit, total) };
  }

  findById(id: string): Promise<ManagedMenuAccess | null> {
    return prisma.menuAccess.findUnique({ where: { id }, select: menuAccessSelect });
  }

  findActiveById(id: string): Promise<ManagedMenuAccess | null> {
    return prisma.menuAccess.findFirst({
      where: { id, isDeleted: false, menuItem: { isDeleted: false, isActive: true, menu: { isActive: true, isDeleted: false } } },
      select: menuAccessSelect,
    });
  }

  findByRule(menuItemId: string, role: UserRole | null, section: UserSection | null, excludeId?: string): Promise<ManagedMenuAccess | null> {
    return prisma.menuAccess.findFirst({
      where: { menuItemId, role, section, ...(excludeId && { id: { not: excludeId } }) },
      select: menuAccessSelect,
    });
  }

  async create(data: MenuAccessCreate): Promise<ManagedMenuAccess> {
    try {
      return await menuWrite(async tx => {
        if (!await tx.menuItem.findFirst({ where: { id: data.menuItemId, isDeleted: false, isActive: true, menu: { isDeleted: false, isActive: true } } })) throw new HttpError('Menu item not found', 404);
        // PostgreSQL unique constraints permit duplicate NULL values. Check
        // nullable role/section identities under the shared write lock as well.
        if (await tx.menuAccess.findFirst({ where: { menuItemId: data.menuItemId, role: data.role, section: data.section } })) {
          throw new HttpError('Menu access rule already exists', 409);
        }
        return tx.menuAccess.create({ data, select: menuAccessSelect });
      });
    } catch (error) {
      return throwConflict(error);
    }
  }

  async update(id: string, data: MenuAccessUpdate): Promise<ManagedMenuAccess> {
    try {
      return await menuWrite(async tx => {
        const current = await tx.menuAccess.findUnique({ where: { id } });
        if (!current) throw new HttpError('Menu access not found', 404);
        if (current.isDeleted) throw new HttpError('Menu access is already deleted', 409);
        if (!await tx.menuItem.findFirst({ where: { id: data.menuItemId ?? current.menuItemId, isDeleted: false, isActive: true, menu: { isDeleted: false, isActive: true } } })) throw new HttpError('Menu item not found', 404);
        if (await tx.menuAccess.findFirst({ where: {
          id: { not: id }, menuItemId: data.menuItemId ?? current.menuItemId,
          role: data.role === undefined ? current.role : data.role,
          section: data.section === undefined ? current.section : data.section,
        } })) throw new HttpError('Menu access rule already exists', 409);
        return tx.menuAccess.update({ where: { id }, data, select: menuAccessSelect });
      });
    } catch (error) {
      return throwConflict(error);
    }
  }

  delete(id: string): Promise<ManagedMenuAccess> {
    return menuWrite(async tx => {
      const current = await tx.menuAccess.findUnique({ where: { id } });
      if (!current) throw new HttpError('Menu access not found', 404);
      if (current.isDeleted) throw new HttpError('Menu access is already deleted', 409);
      return tx.menuAccess.update({ where: { id }, data: { isDeleted: true }, select: menuAccessSelect });
    });
  }
}

export const menuAccessRepository = new MenuAccessRepository();
