import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/db.js';
import { HttpError } from '../../../utils/httpError.js';
import { buildListQuery, buildPagination, defineSortRules } from '../../../utils/listQuery.js';
import { ListMenuItemsInput } from './menu-item.schemas.js';
import { ManagedMenuItem, MenuItemCreate, MenuItemUpdate, PaginatedMenuItems } from './menu-item.types.js';

const menuItemSelect = {
  id: true, menuId: true, key: true, label: true,
  order: true,
  isActive: true, createdAt: true, updatedAt: true,
} satisfies Prisma.MenuItemSelect;

class MenuItemRepository {
  async list(input: ListMenuItemsInput): Promise<PaginatedMenuItems> {
    const query = buildListQuery(input, {
      filters: {
        menuId: (menuId) => ({ menuId }),
        isActive: (isActive) => ({ isActive }),
        search: (search) => ({ OR: [
          { key: { contains: search, mode: 'insensitive' } },
          { label: { contains: search, mode: 'insensitive' } },
        ] }),
      },
      defaultSort: { createdAt: 'desc' },
      sorts: defineSortRules<NonNullable<ListMenuItemsInput['sortBy']>, Prisma.MenuItemOrderByWithRelationInput | Prisma.MenuItemOrderByWithRelationInput[]>({
        menuId: (direction) => ({ menuId: direction }), key: (direction) => ({ key: direction }),
        label: (direction) => ({ label: direction }),
        order: (direction) => [{ menu: { order: direction } }, { order: direction }],
        isActive: (direction) => ({ isActive: direction }),
        updatedAt: (direction) => ({ updatedAt: direction }),
      }),
    });
    const where = {
      AND: [{ isActive: true }, { menu: { isActive: true } }, query.where],
    } satisfies Prisma.MenuItemWhereInput;
    const [items, total] = await Promise.all([
      prisma.menuItem.findMany({ ...query, where, select: menuItemSelect }),
      prisma.menuItem.count({ where }),
    ]);
    return { items, pagination: buildPagination(input.page, input.limit, total) };
  }

  findById(id: string): Promise<ManagedMenuItem | null> {
    return prisma.menuItem.findUnique({ where: { id }, select: menuItemSelect });
  }

  findActiveById(id: string): Promise<ManagedMenuItem | null> {
    return prisma.menuItem.findFirst({
      where: { id, isActive: true, menu: { isActive: true } },
      select: menuItemSelect,
    });
  }

  findByKey(key: string): Promise<ManagedMenuItem | null> {
    return prisma.menuItem.findUnique({ where: { key }, select: menuItemSelect });
  }

  create(data: MenuItemCreate): Promise<ManagedMenuItem> {
    return prisma.menuItem.create({
      data: {
        menuId: data.menuId,
        key: data.key,
        label: data.label,
        order: data.order,
      },
      select: menuItemSelect,
    });
  }

  async update(id: string, data: MenuItemUpdate): Promise<ManagedMenuItem> {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "menu_items" WHERE id = ${id}::uuid FOR UPDATE
    `;
    if (rows.length === 0) throw new HttpError('Menu item not found', 404);
    return prisma.menuItem.update({ where: { id }, data, select: menuItemSelect });
  }

  delete(id: string): Promise<ManagedMenuItem> {
    return prisma.menuItem.delete({ where: { id }, select: menuItemSelect });
  }
}

export const menuItemRepository = new MenuItemRepository();
