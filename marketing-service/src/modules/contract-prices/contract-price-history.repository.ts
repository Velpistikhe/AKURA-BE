import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { formatContractDates } from '../../utils/dateOnly.js';

const fields = [
  ['priceService', 'Service price'], ['priceMaintenance', 'Maintenance price'], ['isActive', 'Active status'],
  ['effectiveFrom', 'Effective from'], ['effectiveUntil', 'Effective until'],
] as const;
type Snapshot = Record<string, unknown> | null;
const snapshot = (value: unknown): Snapshot => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const changes = (before: Snapshot, after: Snapshot, action: string) => fields.flatMap(([field, label]) => {
  const previous = before?.[field] ?? null;
  const current = after?.[field] ?? null;
  return action === 'CREATE' || action === 'IMPORT' || !equal(previous, current)
    ? [{ field, label, before: action === 'CREATE' || action === 'IMPORT' ? null : previous, after: current }]
    : [];
});

export const contractPriceHistoryRepository = {
  listPrices: async (input: { contractId?: string; companyId?: string; itemSizeId?: string; isActive?: boolean; search?: string; page: number; limit: number; sortBy?: 'priceService' | 'priceMaintenance' | 'effectiveFrom' | 'effectiveUntil' | 'createdAt' | 'updatedAt'; sortOrder: 'asc' | 'desc' }, branch: string) => {
    const where = {
      contract: { ...(input.contractId ? { id: input.contractId } : {}), ...(input.companyId ? { companyId: input.companyId } : {}), company: { officeBranchId: branch, revoked: false } },
      ...(input.itemSizeId ? { itemSizeId: input.itemSizeId } : {}), ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
      ...(input.search ? { OR: [{ itemSize: { size: { contains: input.search, mode: 'insensitive' as const } } }, { itemSize: { item: { name: { contains: input.search, mode: 'insensitive' as const } } } }] } : {}),
    };
    const orderBy = input.sortBy ? { [input.sortBy]: input.sortOrder } : { createdAt: 'desc' as const };
    const [prices, total] = await prisma.$transaction([
      prisma.companyContractPrice.findMany({
        where, orderBy, skip: (input.page - 1) * input.limit, take: input.limit,
        include: {
          contract: { include: { company: { select: { id: true, name: true } } } },
          itemSize: { include: { item: { include: { service: { select: { id: true, name: true } } } } } },
        },
      }),
      prisma.companyContractPrice.count({ where }),
    ], { isolationLevel: 'RepeatableRead' });
    return { prices: prices.map(price => ({ ...price, contract: formatContractDates(price.contract) })), pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) } };
  },
  list: async (contractPriceId: string, input: { page: number; limit: number }, branch: string) => {
    const price = await prisma.companyContractPrice.findFirst({ where: { id: contractPriceId, contract: { company: { officeBranchId: branch, revoked: false } } }, select: { id: true } });
    if (!price) throw new HttpError('Contract price not found', 404);
    const where = { officeBranchId: branch, entityType: 'COMPANY_CONTRACT_PRICE', entityId: contractPriceId };
    const [records, total] = await prisma.$transaction([
      prisma.catalogAuditLog.findMany({ where, orderBy: { version: 'desc' }, skip: (input.page - 1) * input.limit, take: input.limit }),
      prisma.catalogAuditLog.count({ where }),
    ], { isolationLevel: 'RepeatableRead' });
    return {
      contractPriceId,
      history: records.map(record => ({
        id: record.id, action: record.action, version: record.version,
        changedBy: { id: record.createdById, name: record.createdByName }, changedAt: record.createdAt,
        changes: changes(snapshot(record.before), snapshot(record.after), record.action),
      })),
      pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) },
    };
  },
};
