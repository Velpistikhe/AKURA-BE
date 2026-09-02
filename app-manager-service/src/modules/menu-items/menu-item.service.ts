import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { CreateMenuItemInput, ListMenuItemsInput, UpdateMenuItemInput } from './menu-item.schemas.js';
import { menuItemRepository } from './menu-item.repository.js';
import { ManagedMenuItem, PaginatedMenuItems } from './menu-item.types.js';

class MenuItemService {
  list(input: ListMenuItemsInput): Promise<PaginatedMenuItems> {
    return menuItemRepository.list(input);
  }

  async get(id: string): Promise<ManagedMenuItem> {
    const item = await menuItemRepository.findById(id);
    if (!item) throw new HttpError('Menu item not found', 404);
    return item;
  }

  async create(data: CreateMenuItemInput): Promise<ManagedMenuItem> {
    // Cek menu exists
    const menu = await prisma.menu.findUnique({ where: { id: data.menuId }, select: { hasItem: true } });
    if (!menu) throw new HttpError('Menu not found', 404);
    if (!menu.hasItem) throw new HttpError('Menu does not allow items', 409);

    // Cek duplikasi key
    const existing = await menuItemRepository.findByKey(data.key);
    if (existing) throw new HttpError(`Menu item with key '${data.key}' already exists`, 409);

    return menuItemRepository.create({
      menuId: data.menuId,
      key: data.key,
      label: data.label,
      order: data.order,
    });
  }

  async update(id: string, data: UpdateMenuItemInput): Promise<ManagedMenuItem> {
    const existing = await menuItemRepository.findById(id);
    if (!existing) throw new HttpError('Menu item not found', 404);

    // Cek duplikasi key jika key diubah
    if (data.key && data.key !== existing.key) {
      const conflict = await menuItemRepository.findByKey(data.key);
      if (conflict) throw new HttpError(`Menu item with key '${data.key}' already exists`, 409);
    }

    // Cek menu baru exists jika menuId diubah
    if (data.menuId && data.menuId !== existing.menuId) {
      const menu = await prisma.menu.findUnique({ where: { id: data.menuId }, select: { hasItem: true } });
      if (!menu) throw new HttpError('Menu not found', 404);
      if (!menu.hasItem) throw new HttpError('Menu does not allow items', 409);
    }

    return menuItemRepository.update(id, data);
  }

  async delete(id: string): Promise<ManagedMenuItem> {
    const existing = await menuItemRepository.findById(id);
    if (!existing) throw new HttpError('Menu item not found', 404);
    return menuItemRepository.delete(id);
  }
}

export const menuItemService = new MenuItemService();
