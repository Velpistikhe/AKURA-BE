import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { itemRepository } from './item.repository.js';
import { CreateItemInput, ListItemsInput, UpdateItemInput } from './item.schemas.js';

export const itemList = (query: ListItemsInput) => itemRepository.list(query);

export const itemService = {
  async validateServiceAndPrices(data: CreateItemInput | UpdateItemInput) {
    const service = await prisma.service.findUnique({
      where: { id: data.serviceId },
      include: { maintenance: true },
    });

    if (!service || !service.isActive) throw new HttpError('Service is inactive or not found', 409);
    if (service.hasService && data.sizes.some((size) => size.priceMaintenancePrimary == null)) {
      throw new HttpError('Maintenance primary price is required', 400);
    }
  },

  async create(data: CreateItemInput) {
    await this.validateServiceAndPrices(data);
    return itemRepository.create(data);
  },
  async get(id: string) {
    const item = await itemRepository.find(id);

    if (!item) throw new HttpError('Item not found', 404);

    return item;
  },
  async update(id: string, data: UpdateItemInput) {
    await this.get(id);
    await this.validateServiceAndPrices(data);
    return itemRepository.update(id, data);
  },
  remove: (id: string) => itemRepository.remove(id),
};
