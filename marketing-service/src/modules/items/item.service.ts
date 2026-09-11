import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { itemRepository } from './item.repository.js';
import { AddItemSizeInput, CreateItemInput, ListItemsInput, ListItemSizesInput, ListContractItemSizesInput } from './item.schemas.js';
import { AuditActor } from '../../types/auth.types.js';

export const itemList = (query: ListItemsInput, officeBranchId: string) => itemRepository.list(query, officeBranchId);

export const itemService = {
  async validateServiceAndPrices(data: CreateItemInput, officeBranchId: string) {
    const service = await prisma.service.findFirst({
      where: { id: data.serviceId, officeBranchId },
    });

    if (!service || !service.isActive) throw new HttpError('Service is inactive or not found', 409);
    if (service.hasMaintenance && data.sizes.some((size) => size.priceMaintenancePrimary == null)) {
      throw new HttpError('Maintenance primary price is required', 400);
    }
  },

  async create(data: CreateItemInput, officeBranchId: string, actor: AuditActor) {
    await this.validateServiceAndPrices(data, officeBranchId);
    return itemRepository.create(data, officeBranchId, actor);
  },
  async addSize(data: AddItemSizeInput, officeBranchId: string, actor: AuditActor) {
    const item = await prisma.item.findFirst({
      where: { id: data.itemId, officeBranchId, isActive: true, service: { officeBranchId, isActive: true } },
      select: { id: true },
    });
    if (!item) throw new HttpError('Item not found', 404);
    return itemRepository.addSize(data, officeBranchId, actor);
  },
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
        where: { id: data.itemId, officeBranchId, isActive: true, service: { officeBranchId, isActive: true } },
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
  async remove(id: string, officeBranchId: string, actor: AuditActor, version: number) {
    const item = await itemRepository.find(id, officeBranchId);
    if (!item) throw new HttpError('Item not found', 404);
    return itemRepository.remove(id, officeBranchId, actor, version);
  },
};
