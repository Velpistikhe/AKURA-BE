import { Prisma } from '@prisma/client';
import { defineSortRules, findAll } from '../../utils/listQuery.js';
import { prisma } from '../../config/db.js';
import { AddItemSizeInput, CreateItemInput, ListItemsInput, ListItemSizesInput } from './item.schemas.js';
import { AuditActor } from '../../types/auth.types.js';
import { HttpError } from '../../utils/httpError.js';

const priceSelect = {
  priceServicePrimary: true,
  priceServiceSisterCompany: true,
  priceMaintenancePrimary: true,
  priceMaintenanceSisterCompany: true,
} satisfies Prisma.ItemPriceSelect;

const flattenSizePrice = ({ price, ...itemSize }: any) => {
  if (!price) throw new Error(`Price is missing for item size ${itemSize.id}`);
  return { ...itemSize, ...price };
};

const flattenItemPrices = ({ sizes, ...item }: any) => ({
  ...item,
  sizes: sizes.map(flattenSizePrice),
});

const toItemSizeCreate = (size: CreateItemInput['sizes'][number] | AddItemSizeInput, actor: AuditActor) => ({
  size: size.size,
  createdById: actor.id,
  createdByName: actor.name,
  price: {
    create: {
      priceServicePrimary: size.priceServicePrimary,
      priceServiceSisterCompany: size.priceServiceSisterCompany,
      priceMaintenancePrimary: size.priceMaintenancePrimary,
      priceMaintenanceSisterCompany: size.priceMaintenanceSisterCompany,
      createdById: actor.id,
      createdByName: actor.name,
    },
  },
});

export const itemRepository = {
  async list(input: ListItemsInput, officeBranchId: string) {
    return findAll<any, NonNullable<ListItemsInput['sortBy']>, ListItemsInput, Prisma.ItemWhereInput, Prisma.ItemOrderByWithRelationInput>(
      input,
      {
      baseWhere: { officeBranchId, isActive: true, service: { officeBranchId, isActive: true } },
      filters: {
        name: (value: string) => ({ name: { contains: value, mode: 'insensitive' } }),
        serviceName: (value: string) => ({ service: { name: { contains: value, mode: 'insensitive' } } }),
      },
      defaultSort: { createdAt: 'desc' },
      sorts: defineSortRules<NonNullable<ListItemsInput['sortBy']>, Prisma.ItemOrderByWithRelationInput>({
        name: (direction) => ({ name: direction }),
        serviceName: (direction) => ({ service: { name: direction } }),
      }),
      },
      (query) => prisma.item.findMany({
        ...query,
        include: { service: { select: { id: true, name: true } } },
      }),
      (where) => prisma.item.count({ where }),
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
        sizes: { where: { isActive: true }, include: { price: { select: priceSelect } } },
      },
    }).then((item) => item ? flattenItemPrices(item) : null),
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
      },
    }),
  async listSizes(input: ListItemSizesInput, officeBranchId: string) {
    const result = await findAll<any, NonNullable<ListItemSizesInput['sortBy']>, ListItemSizesInput, Prisma.ItemSizeWhereInput, Prisma.ItemSizeOrderByWithRelationInput>(
      input,
      {
        baseWhere: {
          itemId: input.itemId,
          isActive: true,
          item: { officeBranchId, isActive: true, service: { officeBranchId, isActive: true } },
        },
        filters: {
          size: (value: string) => ({ size: { contains: value, mode: 'insensitive' } }),
        },
        defaultSort: { createdAt: 'desc' },
        sorts: defineSortRules<NonNullable<ListItemSizesInput['sortBy']>, Prisma.ItemSizeOrderByWithRelationInput>({
          size: (direction) => ({ size: direction }),
        }),
      },
      (query) => prisma.itemSize.findMany({ ...query, include: { price: { select: priceSelect } } }),
      (where) => prisma.itemSize.count({ where }),
    );
    return { sizes: result.items.map(flattenSizePrice), pagination: result.pagination };
  },
  create: (data: CreateItemInput, officeBranchId: string, actor: AuditActor) =>
    prisma.item.create({
      data: {
        officeBranchId,
        serviceId: data.serviceId,
        name: data.name,
        createdById: actor.id,
        createdByName: actor.name,
        sizes: { create: data.sizes.map((size) => toItemSizeCreate(size, actor)) },
      },
      include: { sizes: { include: { price: { select: priceSelect } } } },
    }).then(flattenItemPrices),
  async addSize(data: AddItemSizeInput, officeBranchId: string, actor: AuditActor) {
    try {
      return await prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'item:' + data.itemId}))`;
        const item = await transaction.item.findFirst({
          where: { id: data.itemId, officeBranchId, isActive: true, service: { officeBranchId, isActive: true } },
          select: { id: true },
        });
        if (!item) throw new HttpError('Item not found', 404);
        const duplicate = await transaction.itemSize.findFirst({
          where: { itemId: data.itemId, size: data.size, isActive: true },
          select: { id: true },
        });
        if (duplicate) throw new HttpError('Item size already exists', 409);
        const created = await transaction.itemSize.create({
          data: { itemId: data.itemId, ...toItemSizeCreate(data, actor) },
          include: { price: { select: priceSelect } },
        });
        await transaction.item.update({
          where: { id: data.itemId, officeBranchId },
          data: { updatedById: actor.id, updatedByName: actor.name },
        });
        return flattenSizePrice(created);
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
        throw new HttpError('Item size already exists', 409);
      }
      throw error;
    }
  },
  async removeSize(id: string, officeBranchId: string, actor: AuditActor) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'item-size:' + id}))`;
      const size = await transaction.itemSize.findFirst({
        where: { id, item: { officeBranchId, isActive: true } },
        select: { id: true, itemId: true, isActive: true },
      });
      if (!size) throw new HttpError('Item size not found', 404);
      if (!size.isActive) throw new HttpError('Item size is already inactive', 409);

      const changedAt = new Date();
      const inactivePriceData = {
        isActive: false,
        effectiveUntil: changedAt,
        updatedById: actor.id,
        updatedByName: actor.name,
      };
      await transaction.itemPrice.updateMany({
        where: { itemSizeId: id, isActive: true },
        data: inactivePriceData,
      });
      await transaction.companyContractPrice.updateMany({
        where: { itemSizeId: id, isActive: true },
        data: inactivePriceData,
      });
      const removed = await transaction.itemSize.update({
        where: { id },
        data: { isActive: false, updatedById: actor.id, updatedByName: actor.name },
        include: { price: { select: priceSelect } },
      });
      await transaction.item.update({
        where: { id: size.itemId, officeBranchId },
        data: { updatedById: actor.id, updatedByName: actor.name },
      });
      return flattenSizePrice(removed);
    });
  },
  async remove(id: string, officeBranchId: string, actor: AuditActor) {
    return prisma.$transaction(async (transaction) => {
      const changedAt = new Date();
      const inactivePriceData = {
        isActive: false,
        effectiveUntil: changedAt,
        updatedById: actor.id,
        updatedByName: actor.name,
      };
      await transaction.itemPrice.updateMany({
        where: { itemSize: { itemId: id, isActive: true, item: { officeBranchId } }, isActive: true },
        data: inactivePriceData,
      });
      await transaction.companyContractPrice.updateMany({
        where: { itemSize: { itemId: id, isActive: true, item: { officeBranchId } }, isActive: true },
        data: inactivePriceData,
      });
      await transaction.itemSize.updateMany({
        where: { itemId: id, item: { officeBranchId } },
        data: { isActive: false, updatedById: actor.id, updatedByName: actor.name },
      });
      return transaction.item.update({
        where: { id, officeBranchId },
        data: { isActive: false, updatedById: actor.id, updatedByName: actor.name },
        include: { sizes: { include: { price: { select: priceSelect } } } },
      });
    }).then(flattenItemPrices);
  },
};
