import { UserRole, UserSection } from '@prisma/client';
import { prisma } from '../../../config/db.js';
import { HttpError } from '../../../utils/httpError.js';
import { CreateMenuInput, ListMenusInput, UpdateMenuInput } from './menu.schemas.js';
import { menuRepository } from './menu.repository.js';
import { ManagedMenu, MenusForUserResult, PaginatedMenus } from './menu.types.js';

class MenuService {
  list(input: ListMenusInput): Promise<PaginatedMenus> {
    return menuRepository.list(input);
  }

  async get(id: string): Promise<ManagedMenu> {
    const menu = await menuRepository.findActiveById(id);
    if (!menu) throw new HttpError('Menu not found', 404);
    return menu;
  }

  async create(data: CreateMenuInput): Promise<ManagedMenu> {
    const existing = await menuRepository.findByKey(data.key);
    if (existing) throw new HttpError(`Menu with key '${data.key}' already exists`, 409);
    if (data.hasItem) {
      const itemKeys = data.items.map(({ key }) => key);
      const conflict = await prisma.menuItem.findFirst({ where: { key: { in: itemKeys } }, select: { key: true } });
      if (conflict) throw new HttpError(`Menu item with key '${conflict.key}' already exists`, 409);
    }
    return menuRepository.create({
      key: data.key,
      label: data.label,
      hasItem: data.hasItem,
      order: data.order,
      items: data.hasItem ? data.items : undefined,
    });
  }

  async update(id: string, data: UpdateMenuInput): Promise<ManagedMenu> {
    const existing = await menuRepository.findById(id);
    if (!existing) throw new HttpError('Menu not found', 404);
    if (data.key && data.key !== existing.key) {
      const conflict = await menuRepository.findByKey(data.key);
      if (conflict) throw new HttpError(`Menu with key '${data.key}' already exists`, 409);
    }
    if (data.hasItem === false) {
      const itemCount = await prisma.menuItem.count({ where: { menuId: id } });
      if (itemCount > 0) throw new HttpError('Menu with items cannot set hasItem to false', 409);
    }
    return menuRepository.update(id, data);
  }

  async delete(id: string): Promise<ManagedMenu> {
    const existing = await menuRepository.findById(id);
    if (!existing) throw new HttpError('Menu not found', 404);
    return menuRepository.delete(id);
  }

  getMenusForUser(role: UserRole, section: UserSection | null): Promise<MenusForUserResult> {
    return menuRepository.findMenusForUser(role, section);
  }
}

export const menuService = new MenuService();
