import { Prisma } from '@prisma/client';
import { defineSortRules, findAll } from '../../utils/listQuery.js';
import { prisma } from '../../config/db.js';
import { CreateItemInput, ListItemsInput, UpdateItemInput } from './item.schemas.js';
export const itemRepository = {
  async list(input: ListItemsInput) {
    return findAll<any, NonNullable<ListItemsInput['sortBy']>, ListItemsInput, Prisma.ItemSizeWhereInput, Prisma.ItemSizeOrderByWithRelationInput>(
      input,
      {
      baseWhere: { isActive: true, item: { isActive: true } },
      filters: {
        serviceName: (value: string) => ({ item: { service: { name: { contains: value, mode: 'insensitive' } } } }),
        itemName: (value: string) => ({ item: { name: { contains: value, mode: 'insensitive' } } }),
        size: (value: string) => ({ size: { contains: value, mode: 'insensitive' } }),
      },
      defaultSort: { item: { service: { name: 'asc' } } },
      sorts: defineSortRules<NonNullable<ListItemsInput['sortBy']>, Prisma.ItemSizeOrderByWithRelationInput>({
        serviceName: (direction) => ({ item: { service: { name: direction } } }),
        itemName: (direction) => ({ item: { name: direction } }),
        size: (direction) => ({ size: direction }),
      }),
      },
      (query) => prisma.itemSize.findMany({
        ...query,
        include: { item: { select: { id: true, name: true, serviceId: true, service: { select: { id: true, name: true } } } } },
      }),
      (where) => prisma.itemSize.count({ where }),
    );
  },
  find: (id: string) =>
    prisma.item.findUnique({
      where: { id },
      include: {
        service: {
          select: {
            id: true,
            name: true,
            hasMaintenance: true,
          },
        },
        sizes: { where: { isActive: true } },
      },
    }),
  create: (data: CreateItemInput) =>
    prisma.item.create({
      data: {
        serviceId: data.serviceId,
        name: data.name,
        sizes: { create: data.sizes },
      },
      include: { sizes: true },
    }),
  async update(id: string, data: UpdateItemInput) {
    return prisma.$transaction(async (transaction) => {
      await transaction.itemSize.updateMany({
        where: { itemId: id, isActive: true },
        data: { isActive: false },
      });
      return transaction.item.update({
        where: { id },
        data: {
          serviceId: data.serviceId,
          name: data.name,
          sizes: { create: data.sizes.map((size) => ({ ...size, version: 1 })) },
        },
        include: { sizes: true },
      });
    });
  },
  async remove(id: string) {
    return prisma.$transaction(async (transaction) => {
      await transaction.itemSize.updateMany({
        where: { itemId: id },
        data: { isActive: false },
      });
      return transaction.item.update({
        where: { id },
        data: { isActive: false },
        include: { sizes: true },
      });
    });
  },
};
