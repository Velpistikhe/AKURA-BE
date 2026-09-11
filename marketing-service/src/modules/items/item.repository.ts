import { Prisma } from '@prisma/client';
import { defineSortRules, findAll } from '../../utils/listQuery.js';
import { prisma } from '../../config/db.js';
import { currentBusinessDate } from '../../utils/businessDate.js';
import { AddItemSizeInput, CreateItemInput, ListItemsInput, ListItemSizesInput } from './item.schemas.js';
import { AuditActor } from '../../types/auth.types.js';
import { HttpError } from '../../utils/httpError.js';
import { itemWriteRepository } from './item-write.repository.js';

const priceSelect = {
  id: true, version: true, isActive: true, effectiveFrom: true, effectiveUntil: true,
  priceServicePrimary: true,
  priceServiceSisterCompany: true,
  priceMaintenancePrimary: true,
  priceMaintenanceSisterCompany: true,
} satisfies Prisma.ItemPriceSelect;

const flattenSizePrice = ({ price, ...itemSize }: any, now = new Date()) => {
  const available = price?.isActive && price.effectiveFrom <= now && (price.effectiveUntil == null || price.effectiveUntil > now);
  return { ...itemSize, priceId: price?.id ?? null, priceVersion: price?.version ?? null,
    priceServicePrimary: available ? price.priceServicePrimary : null,
    priceServiceSisterCompany: available ? price.priceServiceSisterCompany : null,
    priceMaintenancePrimary: available ? price.priceMaintenancePrimary : null,
    priceMaintenanceSisterCompany: available ? price.priceMaintenanceSisterCompany : null,
    priceStatus: available ? 'AVAILABLE' : 'UNAVAILABLE',
  };
};

const flattenItemPrices = ({ sizes, ...item }: any) => ({
  ...item,
  sizes: sizes.map((size: any) => flattenSizePrice(size)),
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
  async listSizes(input: ListItemSizesInput, officeBranchId: string, companyId?: string, resolvePrices = false) {
    return prisma.$transaction(async tx => {
    const now = currentBusinessDate();
    const company = companyId ? await tx.company.findFirst({ where: { id: companyId, officeBranchId, revoked: false } }) : null;
    if (companyId && !company) throw new HttpError('Company not found', 404);
    const activeContracts = companyId ? await tx.companyContract.findMany({ where: {
      companyId, isActive: true, status: 'ACTIVE', effectiveFrom: { lte: now }, effectiveUntil: { gt: now },
    }, orderBy: { effectiveFrom: 'desc' }, take: 2 }) : [];
    if (activeContracts.length > 1) throw new HttpError('Multiple current contracts found; resolve overlapping contract periods', 409);
    const contractWhere: Prisma.CompanyContractPriceWhereInput = {
      contractId: { in: activeContracts.map(contract => contract.id) }, isActive: true,
      effectiveFrom: { lte: now },
      OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }],
    };
    const result = await findAll<any, NonNullable<ListItemSizesInput['sortBy']>, ListItemSizesInput, Prisma.ItemSizeWhereInput, Prisma.ItemSizeOrderByWithRelationInput>(
      input,
      {
        baseWhere: {
          ...(companyId && !resolvePrices ? { contractPrices: { some: contractWhere } } : {}),
          isActive: true,
          item: { officeBranchId, isActive: true, service: { officeBranchId, isActive: true } },
        },
        filters: {
          itemId: (value: string) => ({ itemId: value }),
          notIn: (value: string[]) => ({ id: { notIn: value } }),
          size: (value: string) => ({ size: { contains: value, mode: 'insensitive' } }),
          itemName: (value: string) => ({ item: { name: { contains: value, mode: 'insensitive' } } }),
          serviceName: (value: string) => ({ item: { service: { name: { contains: value, mode: 'insensitive' } } } }),
        },
        defaultSort: { createdAt: 'desc' },
        sorts: defineSortRules<NonNullable<ListItemSizesInput['sortBy']>, Prisma.ItemSizeOrderByWithRelationInput>({
          size: (direction) => ({ size: direction }),
        }),
      },
      (query) => tx.itemSize.findMany({
        ...query,
        orderBy: [query.orderBy, { id: 'asc' }],
        include: {
          price: { select: priceSelect },
          ...(companyId ? { contractPrices: { where: contractWhere, include: { contract: true } } } : {}),
          item: { include: { service: { select: { id: true, name: true, type: true, hasMaintenance: true } } } },
        },
      }),
      (where) => tx.itemSize.count({ where }),
    );
    const sizes = result.items.map(row => flattenSizePrice(row, now));
    if (resolvePrices && company) {
      return { company: { id: company.id, isSisterCompany: company.isSisterCompany },
        sizes: sizes.map(({ contractPrices, ...size }) => {
          const source = activeContracts.length ? 'CONTRACT' : company.isSisterCompany ? 'SISTER_COMPANY' : 'PRIMARY';
          const contractPrice = contractPrices?.[0] ?? null;
          const priceService = source === 'CONTRACT' ? contractPrice?.priceService ?? null : source === 'SISTER_COMPANY' ? size.priceServiceSisterCompany : size.priceServicePrimary;
          const priceMaintenance = source === 'CONTRACT' ? contractPrice?.priceMaintenance ?? null : source === 'SISTER_COMPANY' ? size.priceMaintenanceSisterCompany : size.priceMaintenancePrimary;
          const missing = priceService == null || (size.item.service.hasMaintenance && priceMaintenance == null);
          return { ...size, contractPrice, contractId: activeContracts[0]?.id ?? null,
            priceSource: source, priceStatus: missing ? 'UNAVAILABLE' : 'AVAILABLE',
            priceMessage: missing ? (source === 'CONTRACT' ? 'Current contract price is missing or incomplete for this size' : 'Standard price is missing, inactive or incomplete for this size') : null,
            priceService, priceMaintenance,
          };
        }), pagination: result.pagination };
    }
    return {
      sizes: companyId ? sizes.map(({ contractPrices, ...size }) => ({ ...size, contractPrice: contractPrices[0] })) : sizes,
      pagination: result.pagination,
    };
    }, { isolationLevel: 'RepeatableRead' });
  },
  create: (data: CreateItemInput, branch: string, actor: AuditActor) => itemWriteRepository.create(data, branch, actor).then(flattenItemPrices),
  addSize: (data: AddItemSizeInput, branch: string, actor: AuditActor) => itemWriteRepository.addSize(data, branch, actor).then(flattenSizePrice),
  removeSize: (id: string, branch: string, actor: AuditActor, version: number) => itemWriteRepository.removeSize(id, branch, actor, version).then(flattenSizePrice),
  remove: (id: string, branch: string, actor: AuditActor, version: number) => itemWriteRepository.remove(id, branch, actor, version).then(flattenItemPrices),
};
