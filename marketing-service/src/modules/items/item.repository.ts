import { Prisma } from '@prisma/client';
import { defineSortRules, findAll } from '../../utils/listQuery.js';
import { prisma } from '../../config/db.js';
import { CreateItemInput, ListItemsInput, UpdateItemInput } from './item.schemas.js';
export const itemRepository = {
  async list(input: ListItemsInput, officeBranchId: string) {
    return findAll<any, NonNullable<ListItemsInput['sortBy']>, ListItemsInput, Prisma.ItemSizeWhereInput, Prisma.ItemSizeOrderByWithRelationInput>(
      input,
      {
      baseWhere: { isActive: true, item: { officeBranchId, isActive: true, service: { officeBranchId, isActive: true } } },
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
        include: { item: { select: { id: true, officeBranchId: true, name: true, serviceId: true, service: { select: { id: true, name: true } } } } },
      }),
      (where) => prisma.itemSize.count({ where }),
    );
  },
  find: (id: string, officeBranchId: string) =>
    prisma.item.findFirst({
      where: { id, officeBranchId },
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
  findActive: (id: string, officeBranchId: string) =>
    prisma.item.findFirst({
      where: { id, officeBranchId, isActive: true, service: { officeBranchId, isActive: true } },
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
  create: (data: CreateItemInput, officeBranchId: string) =>
    prisma.item.create({
      data: {
        officeBranchId,
        serviceId: data.serviceId,
        name: data.name,
        sizes: { create: data.sizes },
      },
      include: { sizes: true },
    }),
  async update(id: string, officeBranchId: string, data: UpdateItemInput) {
    return prisma.$transaction(async (transaction) => {
      await transaction.itemSize.updateMany({
        where: { itemId: id, isActive: true, item: { officeBranchId } },
        data: { isActive: false },
      });
      return transaction.item.update({
        where: { id, officeBranchId },
        data: {
          serviceId: data.serviceId,
          name: data.name,
          sizes: { create: data.sizes.map((size) => ({ ...size, version: 1 })) },
        },
        include: { sizes: true },
      });
    });
  },
  async remove(id: string, officeBranchId: string) {
    return prisma.$transaction(async (transaction) => {
      await transaction.itemSize.updateMany({
        where: { itemId: id, item: { officeBranchId } },
        data: { isActive: false },
      });
      return transaction.item.update({
        where: { id, officeBranchId },
        data: { isActive: false },
        include: { sizes: true },
      });
    });
  },
};
