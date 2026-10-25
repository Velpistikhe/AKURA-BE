import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { itemRepository } from './item.repository.js';
import { AddItemSizeInput, CreateItemInput, CreateItemScopeInput, ListItemsInput, ListItemSizesInput, ListContractItemSizesInput } from './item.schemas.js';
import { AuditActor } from '../../types/auth.types.js';

export const itemList = (query: ListItemsInput, officeBranchId: string) => itemRepository.list(query, officeBranchId);

export const itemService = {
  create: (data: CreateItemInput, officeBranchId: string, actor: AuditActor) => itemRepository.create(data, officeBranchId, actor),
  addSize: (data: AddItemSizeInput, officeBranchId: string, actor: AuditActor) => itemRepository.addSize(data, officeBranchId, actor),
  addInspectionScopes: (id: string, data: CreateItemScopeInput, officeBranchId: string) => itemRepository.addInspectionScopes(id, data, officeBranchId),
  async listSizes(data: ListItemSizesInput, officeBranchId: string) {
    await this.validateSizeListItem(data, officeBranchId);
    return itemRepository.listSizes(data, officeBranchId);
  },
  async listContractSizes(data: ListContractItemSizesInput, officeBranchId: string) {
    const company = await prisma.company.findFirst({
      where: { id: data.companyId, officeBranchId, revoked: false }, select: { id: true },
    });
    if (!company) throw new HttpError('Company not found', 404);
    await this.validateSizeListItem(data, officeBranchId);
    return itemRepository.listSizes(data, officeBranchId, data.companyId);
  },
  async validateSizeListItem(data: ListItemSizesInput, officeBranchId: string) {
    if (data.itemId) {
      const item = await prisma.item.findFirst({
        where: { id: data.itemId, officeBranchId, isActive: true },
        select: { id: true },
      });
      if (!item) throw new HttpError('Item not found', 404);
    }
  },
  async get(id: string, officeBranchId: string) {
    const item = await itemRepository.findActive(id, officeBranchId);

    if (!item) throw new HttpError('Item not found', 404);

    return item;
  },
  async removeSize(id: string, officeBranchId: string, actor: AuditActor, version: number) {
    return itemRepository.removeSize(id, officeBranchId, actor, version);
  },
  remove: (id: string, officeBranchId: string, actor: AuditActor, version: number) => itemRepository.remove(id, officeBranchId, actor, version),
};
