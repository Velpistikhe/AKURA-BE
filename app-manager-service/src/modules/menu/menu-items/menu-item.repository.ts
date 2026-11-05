import { menuWrite } from '../menu-write.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/db.js';
import { HttpError } from '../../../utils/httpError.js';
import { buildListQuery, buildPagination, defineSortRules } from '../../../utils/listQuery.js';
import { recordAudit, type AuditActor } from '../../../utils/audit.js';
import { ListMenuItemsInput } from './menu-item.schemas.js';
import { ManagedMenuItem, MenuItemCreate, MenuItemUpdate, PaginatedMenuItems } from './menu-item.types.js';

const menuItemSelect = {
  isDeleted: true,
  id: true, menuId: true, key: true, label: true,
  order: true,
  isActive: true, createdAt: true, updatedAt: true,
} satisfies Prisma.MenuItemSelect;

/**
 * The version of a menu item row for the audit trail.
 *
 * The row has no version column, so the timestamp of the change is used. The
 * audit entry is unique per (entity, version), and the timestamp changes on
 * every write, so each write produces exactly one entry.
 */
const auditVersion = (row: { updatedAt: Date }): number => row.updatedAt.getTime();

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
      AND: [{ isDeleted: false }, { isActive: true }, { menu: { isActive: true, isDeleted: false } }, query.where],
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
      where: { id, isDeleted: false, isActive: true, menu: { isActive: true, isDeleted: false } },
      select: menuItemSelect,
    });
  }

  findByKey(key: string): Promise<ManagedMenuItem | null> {
    return prisma.menuItem.findUnique({ where: { key }, select: menuItemSelect });
  }

  create(data: MenuItemCreate, actor: AuditActor): Promise<ManagedMenuItem> {
    return menuWrite(async tx => {
      const parent = await tx.menu.findFirst({ where: { id: data.menuId, isDeleted: false, isActive: true } });
      if (!parent) throw new HttpError('Menu not found', 404);
      if (!parent.hasItem) throw new HttpError('Menu does not allow items', 409);
      const created = await tx.menuItem.create({
        data: {
          menuId: data.menuId,
          key: data.key,
          label: data.label,
          order: data.order,
        },
        select: menuItemSelect,
      });
      await recordAudit(tx, {
        module: 'menu',
        entityType: 'MENU_ITEM',
        entityId: created.id,
        version: auditVersion(created),
        action: 'CREATE',
        before: null,
        after: created,
        actor,
      });
      return created;
    });
  }

  async update(id: string, data: MenuItemUpdate, actor: AuditActor): Promise<ManagedMenuItem> {
    return menuWrite(async tx => {
      const current = await tx.menuItem.findUnique({ where: { id } });
      if (!current) throw new HttpError('Menu item not found', 404);
      if (current.isDeleted) throw new HttpError('Menu item is already deleted', 409);
      const parent = await tx.menu.findFirst({ where: { id: data.menuId ?? current.menuId, isDeleted: false, isActive: true } });
      if (!parent) throw new HttpError('Menu not found', 404);
      if (!parent.hasItem) throw new HttpError('Menu does not allow items', 409);
      const before = await tx.menuItem.findUniqueOrThrow({ where: { id }, select: menuItemSelect });
      const updated = await tx.menuItem.update({ where: { id }, data, select: menuItemSelect });
      await recordAudit(tx, {
        module: 'menu',
        entityType: 'MENU_ITEM',
        entityId: updated.id,
        version: auditVersion(updated),
        action: 'UPDATE',
        before,
        after: updated,
        actor,
      });
      return updated;
    });
  }

  delete(id: string, actor: AuditActor): Promise<ManagedMenuItem> {
    return menuWrite(async tx => {
      const current = await tx.menuItem.findUnique({ where: { id } });
      if (!current) throw new HttpError('Menu item not found', 404);
      if (current.isDeleted) throw new HttpError('Menu item is already deleted', 409);
      if (await tx.menuAccess.count({ where: { menuItemId: id, isDeleted: false } })) {
        throw new HttpError('Menu item with access rules cannot be deleted; delete its access rules first', 409);
      }
      const before = await tx.menuItem.findUniqueOrThrow({ where: { id }, select: menuItemSelect });
      const deleted = await tx.menuItem.update({ where: { id }, data: { isDeleted: true, isActive: false }, select: menuItemSelect });
      await recordAudit(tx, {
        module: 'menu',
        entityType: 'MENU_ITEM',
        entityId: deleted.id,
        version: auditVersion(deleted),
        action: 'DELETE',
        before,
        after: deleted,
        actor,
      });
      return deleted;
    });
  }
}

export const menuItemRepository = new MenuItemRepository();
