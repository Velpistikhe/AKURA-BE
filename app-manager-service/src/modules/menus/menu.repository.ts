import { Prisma, UserRole, UserSection } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { buildListQuery, buildPagination, defineSortRules } from '../../utils/listQuery.js';
import { ListMenusInput } from './menu.schemas.js';
import { ManagedMenu, MenuUpdate, MenusForUserResult, PaginatedMenus } from './menu.types.js';

const menuSelect = {
  id: true, key: true, label: true,
  order: true, isActive: true, createdAt: true, updatedAt: true,
} satisfies Prisma.MenuSelect;

class MenuRepository {
  async list(input: ListMenusInput): Promise<PaginatedMenus> {
    const query = buildListQuery(input, {
      filters: {
        isActive: (isActive) => ({ isActive }),
        search: (search) => ({ OR: [
          { key: { contains: search, mode: 'insensitive' } },
          { label: { contains: search, mode: 'insensitive' } },
        ] }),
      },
      defaultSort: { createdAt: 'desc' },
      sorts: defineSortRules<NonNullable<ListMenusInput['sortBy']>, Prisma.MenuOrderByWithRelationInput>({
        key: (direction) => ({ key: direction }), label: (direction) => ({ label: direction }),
        order: (direction) => ({ order: direction }), isActive: (direction) => ({ isActive: direction }),
        updatedAt: (direction) => ({ updatedAt: direction }),
      }),
    });
    const [menus, total] = await Promise.all([
      prisma.menu.findMany({ ...query, select: menuSelect }),
      prisma.menu.count({ where: query.where }),
    ]);
    return { menus, pagination: buildPagination(input.page, input.limit, total) };
  }

  findById(id: string): Promise<ManagedMenu | null> {
    return prisma.menu.findUnique({ where: { id }, select: menuSelect });
  }

  findByKey(key: string): Promise<ManagedMenu | null> {
    return prisma.menu.findUnique({ where: { key }, select: menuSelect });
  }

  create(data: { key: string; label: string; order: number }): Promise<ManagedMenu> {
    return prisma.menu.create({
      data: {
        key: data.key,
        label: data.label,
        order: data.order,
      },
      select: menuSelect,
    });
  }

  async update(id: string, data: MenuUpdate): Promise<ManagedMenu> {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "menus" WHERE id = ${id}::uuid FOR UPDATE
      `;
      if (rows.length === 0) throw new HttpError('Menu not found', 404);
      return tx.menu.update({
        where: { id },
        data,
        select: menuSelect,
      });
    });
  }

  delete(id: string): Promise<ManagedMenu> {
    return prisma.menu.delete({ where: { id }, select: menuSelect });
  }

  async findMenusForUser(role: UserRole, section: UserSection | null): Promise<MenusForUserResult> {
    const items = await prisma.menuItem.findMany({
      where: {
        isActive: true,
        menu: { isActive: true },
        accesses: {
          some: {
            AND: [
              { OR: [{ role: null }, { role }] },
              section ? { OR: [{ section: null }, { section }] } : { section: null },
            ],
          },
        },
      },
      select: {
        key: true, label: true, path: true, order: true,
        menu: { select: { id: true, key: true, label: true, order: true } },
      },
      orderBy: [{ menu: { order: 'asc' } }, { order: 'asc' }],
    });

    const menus = new Map<string, MenusForUserResult[number]>();
    for (const item of items) {
      let menu = menus.get(item.menu.id);
      if (!menu) {
        menu = { key: item.menu.key, label: item.menu.label, order: item.menu.order, items: [] };
        menus.set(item.menu.id, menu);
      }
      menu.items.push({ key: item.key, label: item.label, path: item.path, order: item.order });
    }
    return [...menus.values()];
  }
}

export const menuRepository = new MenuRepository();
