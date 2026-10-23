import { menuWrite } from '../menu-write.js';
import { Prisma, UserRole, UserSection } from '@prisma/client';
import { prisma } from '../../../config/db.js';
import { HttpError } from '../../../utils/httpError.js';
import { buildListQuery, buildPagination, defineSortRules } from '../../../utils/listQuery.js';
import { ListMenusInput } from './menu.schemas.js';
import { ManagedMenu, MenuUpdate, MenusForUserResult, PaginatedMenus } from './menu.types.js';

const menuSelect = {
  isDeleted: true,
  id: true, key: true, label: true,
  hasItem: true, order: true, isActive: true, createdAt: true, updatedAt: true,
} satisfies Prisma.MenuSelect;

class MenuRepository {
  async list(input: ListMenusInput): Promise<PaginatedMenus> {
    const query = buildListQuery(input, {
      filters: {
        hasItem: (hasItem) => ({ hasItem }),
        isActive: (isActive) => ({ isActive }),
        search: (search) => ({ OR: [
          { key: { contains: search, mode: 'insensitive' } },
          { label: { contains: search, mode: 'insensitive' } },
        ] }),
      },
      defaultSort: { createdAt: 'desc' },
      sorts: defineSortRules<NonNullable<ListMenusInput['sortBy']>, Prisma.MenuOrderByWithRelationInput>({
        key: (direction) => ({ key: direction }), label: (direction) => ({ label: direction }),
        hasItem: (direction) => ({ hasItem: direction }), order: (direction) => ({ order: direction }),
        isActive: (direction) => ({ isActive: direction }),
        updatedAt: (direction) => ({ updatedAt: direction }),
      }),
    });
    const where = { AND: [{ isDeleted: false }, { isActive: true }, query.where] } satisfies Prisma.MenuWhereInput;
    const [menus, total] = await Promise.all([
      prisma.menu.findMany({ ...query, where, select: menuSelect }),
      prisma.menu.count({ where }),
    ]);
    return { menus, pagination: buildPagination(input.page, input.limit, total) };
  }

  findById(id: string): Promise<ManagedMenu | null> {
    return prisma.menu.findUnique({ where: { id }, select: menuSelect });
  }

  findActiveById(id: string): Promise<ManagedMenu | null> {
    return prisma.menu.findFirst({ where: { id, isDeleted: false, isActive: true }, select: menuSelect });
  }

  findByKey(key: string): Promise<ManagedMenu | null> {
    return prisma.menu.findUnique({ where: { key }, select: menuSelect });
  }

  create(data: { key: string; label: string; hasItem: boolean; order: number; items?: { key: string; label: string; order: number }[] }): Promise<ManagedMenu> {
    return menuWrite(tx => tx.menu.create({
      data: {
        key: data.key,
        label: data.label,
        hasItem: data.hasItem,
        order: data.order,
        items: data.items ? { create: data.items } : undefined,
      },
      select: menuSelect,
    }));
  }

  async update(id: string, data: MenuUpdate): Promise<ManagedMenu> {
    return menuWrite(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "menus" WHERE id = ${id}::uuid FOR UPDATE
      `;
      if (rows.length === 0) throw new HttpError('Menu not found', 404);
      const current = await tx.menu.findUniqueOrThrow({ where: { id } });
      if (current.isDeleted) throw new HttpError('Menu is already deleted', 409);
      if (data.hasItem === false && await tx.menuItem.count({ where: { menuId: id, isDeleted: false } })) {
        throw new HttpError('Menu with items cannot set hasItem to false', 409);
      }
      return tx.menu.update({
        where: { id },
        data,
        select: menuSelect,
      });
    });
  }

  delete(id: string): Promise<ManagedMenu> {
    return menuWrite(async tx => {
      const current = await tx.menu.findUnique({ where: { id } });
      if (!current) throw new HttpError('Menu not found', 404);
      if (current.isDeleted) throw new HttpError('Menu is already deleted', 409);
      if (await tx.menuItem.count({ where: { menuId: id, isDeleted: false } })) {
        throw new HttpError('Menu with items cannot be deleted; delete its items first', 409);
      }
      return tx.menu.update({ where: { id }, data: { isDeleted: true, isActive: false }, select: menuSelect });
    });
  }

  async findMenusForUser(role: UserRole, section: UserSection | null): Promise<MenusForUserResult> {
    const items = await prisma.menuItem.findMany({
      where: {
        isActive: true,
        isDeleted: false,
        menu: { isActive: true, isDeleted: false },
        accesses: {
          some: {
            isDeleted: false,
            AND: [
              { OR: [{ role: null }, { role }] },
              section ? { OR: [{ section: null }, { section }] } : { section: null },
            ],
          },
        },
      },
      select: {
        key: true, label: true, order: true,
        menu: { select: { id: true, key: true, label: true, hasItem: true, order: true } },
      },
      orderBy: [{ menu: { order: 'asc' } }, { order: 'asc' }],
    });

    const menus = new Map<string, MenusForUserResult[number]>();
    for (const item of items) {
      let menu = menus.get(item.menu.id);
      if (!menu) {
        menu = { key: item.menu.key, label: item.menu.label, hasItem: item.menu.hasItem, order: item.menu.order, items: [] };
        menus.set(item.menu.id, menu);
      }
      menu.items.push({ key: item.key, label: item.label, order: item.order });
    }
    return [...menus.values()];
  }
}

export const menuRepository = new MenuRepository();
