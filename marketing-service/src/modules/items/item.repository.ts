import { priceContext, quotationOptions } from './quotation-price.js';
import { Prisma } from '@prisma/client';
import { defineSortRules, findAll } from '../../utils/listQuery.js';
import { prisma } from '../../config/db.js';
import { AddItemSizeInput, ListItemsInput, ListItemSizesInput, ListContractPriceOptionsInput } from './item.schemas.js';
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

const includeItemScopes = { scopes: { where: { revoked: false }, orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] } } satisfies Prisma.ItemInclude;
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

const flattenItemScopes = <T extends { scopes: Array<{ id: string; itemId: string | null; type: string; scope: string; revoked: boolean; createdAt: Date; updatedAt: Date }> }>({ scopes, ...item }: T) => ({
  ...item,
  inspectionScopes: scopes.filter(scope => scope.type === 'INSPECTION').map(scope => ({ id: scope.id, itemId: scope.itemId, inspectionScope: scope.scope, revoked: scope.revoked, createdAt: scope.createdAt, updatedAt: scope.updatedAt })),
  maintenanceScopes: scopes.filter(scope => scope.type === 'MAINTENANCE').map(scope => ({ id: scope.id, itemId: scope.itemId, scope: scope.scope, revoked: scope.revoked, createdAt: scope.createdAt, updatedAt: scope.updatedAt })),
});

const flattenItemPrices = ({ sizes, ...item }: any) => ({
  ...item,
  sizes: sizes.map((size: any) => flattenSizePrice(size)),
});

export const itemRepository = {
  async list(input: ListItemsInput, officeBranchId: string) {
    return prisma.$transaction(async tx => findAll<any, NonNullable<ListItemsInput['sortBy']>, ListItemsInput, Prisma.ItemWhereInput, Prisma.ItemOrderByWithRelationInput>(
      input,
      {
      baseWhere: { officeBranchId, isActive: true },
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
      (query) => tx.item.findMany({
        ...query,
        orderBy: [query.orderBy, { id: 'asc' }],
        include: { service: { select: { id: true, name: true } }, ...includeItemScopes },
      }).then(rows => rows.map(flattenItemScopes)),
      (where) => tx.item.count({ where }),
    ), { isolationLevel: 'RepeatableRead' });
  },
  find: (id: string, officeBranchId: string) =>
    prisma.item.findFirst({
      where: { id, officeBranchId },
      include: { service: { select: { id: true, name: true } }, ...includeItemScopes, sizes: { where: { isActive: true }, include: { price: { select: priceSelect } } } },
    }).then(item => item ? flattenItemPrices(flattenItemScopes(item)) : null),
  findActive: (id: string, officeBranchId: string) =>
    prisma.item.findFirst({
      where: { id, officeBranchId, isActive: true },
      include: { service: { select: { id: true, name: true, hasMaintenance: true } }, ...includeItemScopes },
}).then(item => item ? flattenItemScopes(item) : null),
  async listSizes(input: ListItemSizesInput, officeBranchId: string, companyId?: string, resolvePrices = false) {
    return prisma.$transaction(async tx => {
    const now = new Date();
    const context = companyId ? await priceContext(tx, companyId, officeBranchId, now) : null;
    const contractWhere: Prisma.CompanyContractPriceWhereInput = { contractId: context?.contract?.id ?? '00000000-0000-0000-0000-000000000000' };
    const activeCatalog: Prisma.ItemSizeWhereInput = { isActive: true, item: { isActive: true } };
    if (input.itemId && !await tx.item.findFirst({ where: { id: input.itemId, officeBranchId }, select: { id: true } })) throw new HttpError('Item not found', 404);
    if (resolvePrices && context) return quotationOptions(tx, input, context, officeBranchId, now);
    const result = await findAll<any, NonNullable<ListItemSizesInput['sortBy']>, ListItemSizesInput, Prisma.ItemSizeWhereInput, Prisma.ItemSizeOrderByWithRelationInput>(
      input,
      {
        baseWhere: {
          item: { officeBranchId },
          ...(companyId ? resolvePrices
            ? { OR: [activeCatalog, { contractPrices: { some: contractWhere } }] }
            : { contractPrices: { some: contractWhere } }
            : { AND: [activeCatalog] }),
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
          price: true,
          ...(companyId ? { contractPrices: { where: contractWhere, include: { contract: true } } } : {}),
          item: { include: { service: { select: { id: true, name: true, type: true, hasMaintenance: true, isActive: true, version: true } } } },
        },
      }),
      (where) => tx.itemSize.count({ where }),
    );
    const sizes = result.items.map(row => flattenSizePrice(row, now));
    return {
      sizes: companyId ? sizes.map(({ contractPrices, ...size }) => ({ ...size, contractPrice: contractPrices[0] })) : sizes,
      pagination: result.pagination,
    };
    }, { isolationLevel: 'RepeatableRead' });
  },
  async listContractPriceOptions(input: ListContractPriceOptionsInput, contractId: string, branch: string) {
    return prisma.$transaction(async tx => {
      const contract = await tx.companyContract.findFirst({
        where: { id: contractId, isDeleted: false, company: { officeBranchId: branch, revoked: false } },
        select: { id: true },
      });
      if (!contract) throw new HttpError('Company contract not found in the current branch', 404);

      const serviceLabel = Prisma.sql`COALESCE(svc.name, '')`;
      const conditions = [
        Prisma.sql`i.office_branch_id = ${branch}::uuid`,
        Prisma.sql`i.is_active = true`,
        Prisma.sql`s.is_active = true`,
        Prisma.sql`(svc.id IS NULL OR svc.is_active = true)`,
        Prisma.sql`NOT EXISTS (SELECT 1 FROM company_contract_prices cp WHERE cp.contract_id = ${contractId}::uuid AND cp.item_size_id = s.id AND cp.is_active = true)`,
      ];
      if (input.itemId) conditions.push(Prisma.sql`i.id = ${input.itemId}::uuid`);
      if (input.notIn?.length) conditions.push(Prisma.sql`s.id::text NOT IN (${Prisma.join(input.notIn)})`);
      if (input.size) conditions.push(Prisma.sql`strpos(lower(COALESCE(s.size, '')), lower(${input.size})) > 0`);
      if (input.itemName) conditions.push(Prisma.sql`strpos(lower(i.name), lower(${input.itemName})) > 0`);
      if (input.serviceName) conditions.push(Prisma.sql`strpos(lower(${serviceLabel}), lower(${input.serviceName})) > 0`);
      const where = Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`;
      const order = input.sortBy === 'size'
        ? Prisma.sql`s.size ${input.sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`}`
        : Prisma.sql`s.created_at DESC`;
      const [rows, count] = await Promise.all([
        tx.$queryRaw<Array<{ id: string; itemId: string; size: string | null; version: number; itemName: string; serviceName: string | null }>>(Prisma.sql`
          SELECT s.id, s.item_id AS "itemId", s.size, s.version, i.name AS "itemName", svc.name AS "serviceName"
          FROM item_sizes s
          JOIN items i ON i.id = s.item_id
          LEFT JOIN services svc ON svc.id = i.service_id
          ${where}
          ORDER BY ${order}, s.id ASC
          LIMIT ${input.limit} OFFSET ${(input.page - 1) * input.limit}`),
        tx.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT count(*) AS total FROM item_sizes s JOIN items i ON i.id = s.item_id LEFT JOIN services svc ON svc.id = i.service_id ${where}`),
      ]);
      const total = Number(count[0]?.total ?? 0n);
      return { sizes: rows, pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) } };
    }, { isolationLevel: 'RepeatableRead' });
  },

  create: (data: import('./item.schemas.js').CreateItemInput, branch: string, actor: AuditActor) => itemWriteRepository.create(data, branch, actor).then(item => flattenItemPrices(flattenItemScopes(item))),

  addSize: (data: AddItemSizeInput, branch: string, actor: AuditActor) => itemWriteRepository.addSize(data, branch, actor).then(flattenSizePrice),

  removeSize: (id: string, branch: string, actor: AuditActor, version: number) => itemWriteRepository.removeSize(id, branch, actor, version).then(flattenSizePrice),
  remove: (id: string, branch: string, actor: AuditActor, version: number) => itemWriteRepository.remove(id, branch, actor, version).then(flattenItemPrices),
};
