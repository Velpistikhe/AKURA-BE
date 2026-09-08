import { prisma } from '../../../config/db.js';
import { HttpError } from '../../../utils/httpError.js';
import { CreateMenuAccessInput, ListMenuAccessesInput, UpdateMenuAccessInput } from './menu-access.schemas.js';
import { menuAccessRepository } from './menu-access.repository.js';
import { ManagedMenuAccess, PaginatedMenuAccesses } from './menu-access.types.js';

class MenuAccessService {
  list(input: ListMenuAccessesInput): Promise<PaginatedMenuAccesses> {
    return menuAccessRepository.list(input);
  }

  async get(id: string): Promise<ManagedMenuAccess> {
    const access = await menuAccessRepository.findActiveById(id);
    if (!access) throw new HttpError('Menu access not found', 404);
    return access;
  }

  async create(data: CreateMenuAccessInput): Promise<ManagedMenuAccess> {
    const menuItem = await prisma.menuItem.findUnique({ where: { id: data.menuItemId }, select: { id: true } });
    if (!menuItem) throw new HttpError('Menu item not found', 404);
    const conflict = await menuAccessRepository.findByRule(data.menuItemId, data.role, data.section);
    if (conflict) throw new HttpError('Menu access rule already exists', 409);
    return menuAccessRepository.create(data);
  }

  async update(id: string, data: UpdateMenuAccessInput): Promise<ManagedMenuAccess> {
    const existing = await menuAccessRepository.findById(id);
    if (!existing) throw new HttpError('Menu access not found', 404);
    const menuItemId = data.menuItemId ?? existing.menuItemId;
    const role = data.role !== undefined ? data.role : existing.role;
    const section = data.section !== undefined ? data.section : existing.section;
    if (menuItemId !== existing.menuItemId) {
      const menuItem = await prisma.menuItem.findUnique({ where: { id: menuItemId }, select: { id: true } });
      if (!menuItem) throw new HttpError('Menu item not found', 404);
    }
    const conflict = await menuAccessRepository.findByRule(menuItemId, role, section, id);
    if (conflict) throw new HttpError('Menu access rule already exists', 409);
    return menuAccessRepository.update(id, data);
  }

  async delete(id: string): Promise<ManagedMenuAccess> {
    const existing = await menuAccessRepository.findById(id);
    if (!existing) throw new HttpError('Menu access not found', 404);
    return menuAccessRepository.delete(id);
  }
}

export const menuAccessService = new MenuAccessService();
