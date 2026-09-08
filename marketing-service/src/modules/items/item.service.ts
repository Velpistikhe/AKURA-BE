import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { itemRepository } from './item.repository.js';
import { CreateItemInput, ListItemsInput, UpdateItemInput } from './item.schemas.js';

export const itemList = (query: ListItemsInput, officeBranchId: string) => itemRepository.list(query, officeBranchId);

export const itemService = {
  async validateServiceAndPrices(data: CreateItemInput | UpdateItemInput, officeBranchId: string) {
    const service = await prisma.service.findFirst({
      where: { id: data.serviceId, officeBranchId },
    });

    if (!service || !service.isActive) throw new HttpError('Service is inactive or not found', 409);
    if (service.hasMaintenance && data.sizes.some((size) => size.priceMaintenancePrimary == null)) {
      throw new HttpError('Maintenance primary price is required', 400);
    }
  },

  async create(data: CreateItemInput, officeBranchId: string) {
    await this.validateServiceAndPrices(data, officeBranchId);
    return itemRepository.create(data, officeBranchId);
  },
  async get(id: string, officeBranchId: string) {
    const item = await itemRepository.findActive(id, officeBranchId);

    if (!item) throw new HttpError('Item not found', 404);

    return item;
  },
  async update(id: string, data: UpdateItemInput, officeBranchId: string) {
    const item = await itemRepository.find(id, officeBranchId);
    if (!item) throw new HttpError('Item not found', 404);
    await this.validateServiceAndPrices(data, officeBranchId);
    return itemRepository.update(id, officeBranchId, data);
  },
  async remove(id: string, officeBranchId: string) {
    const item = await itemRepository.find(id, officeBranchId);
    if (!item) throw new HttpError('Item not found', 404);
    return itemRepository.remove(id, officeBranchId);
  },
};
