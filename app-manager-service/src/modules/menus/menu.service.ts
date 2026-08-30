import { UserRole, UserSection } from '@prisma/client';
import { HttpError } from '../../utils/httpError.js';
import { CreateMenuInput, ListMenusInput, UpdateMenuInput } from './menu.schemas.js';
import { menuRepository } from './menu.repository.js';
import { ManagedMenu, MenusForUserResult, PaginatedMenus } from './menu.types.js';

class MenuService {
  list(input: ListMenusInput): Promise<PaginatedMenus> {
    return menuRepository.list(input);
  }

  async get(id: string): Promise<ManagedMenu> {
    const menu = await menuRepository.findById(id);
    if (!menu) throw new HttpError('Menu not found', 404);
    return menu;
  }

  async create(data: CreateMenuInput): Promise<ManagedMenu> {
    const existing = await menuRepository.findByKey(data.key);
    if (existing) throw new HttpError(`Menu with key '${data.key}' already exists`, 409);
    return menuRepository.create({ key: data.key, label: data.label, order: data.order });
  }

  async update(id: string, data: UpdateMenuInput): Promise<ManagedMenu> {
    const existing = await menuRepository.findById(id);
    if (!existing) throw new HttpError('Menu not found', 404);
    if (data.key && data.key !== existing.key) {
      const conflict = await menuRepository.findByKey(data.key);
      if (conflict) throw new HttpError(`Menu with key '${data.key}' already exists`, 409);
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
