import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';

type HistoryKind = 'ITEM' | 'ITEM_SIZE' | 'ITEM_PRICE';
const labels: Record<string, string> = {
  name: 'Item name', size: 'Size', isActive: 'Active status',
  priceServicePrimary: 'Primary company inspection price',
  priceServiceSisterCompany: 'Sister company inspection price',
  priceMaintenancePrimary: 'Primary company maintenance price',
  priceMaintenanceSisterCompany: 'Sister company maintenance price',
  priceService: 'Contract inspection price', priceMaintenance: 'Contract maintenance price',
  effectiveFrom: 'Effective from', effectiveUntil: 'Effective until',
};
const actions: Record<string, string> = {
  CREATE: 'Created', UPDATE: 'Updated', DEACTIVATE: 'Deactivated',
  CHILD_UPDATE: 'Size or price reference updated', PRICE_UPDATE: 'Price updated', IMPORT: 'Imported from Excel',
};
const snapshot = (value: Prisma.JsonValue | null): Prisma.JsonObject =>
  value && typeof value === 'object' && !Array.isArray(value) ? value : {};

export const itemHistoryRepository = {
  read: (kind: HistoryKind, id: string, officeBranchId: string, input: { page: number; limit: number }) => prisma.$transaction(async tx => {
    // No active filter: history remains accessible after any ancestor is deactivated.
    const item = kind === 'ITEM'
      ? await tx.item.findFirst({ where: { id, officeBranchId }, select: { id: true } })
      : null;
    const size = kind !== 'ITEM'
      ? await tx.itemSize.findFirst({ where: { id, item: { officeBranchId } }, select: { id: true, itemId: true } })
      : null;
    if (!item && !size) throw new HttpError(kind === 'ITEM' ? 'Item not found' : 'Item size not found', 404);
    const sizes = size ? [size] : await tx.itemSize.findMany({ where: { itemId: id }, select: { id: true } });
    const sizeIds = sizes.map(row => row.id);
    const prices = await tx.itemPrice.findMany({ where: { itemSizeId: { in: sizeIds } }, select: { id: true } });
    if (kind === 'ITEM_PRICE' && !prices.length) throw new HttpError('Item price not found', 404);
    const contractPrices = kind === 'ITEM_PRICE' ? [] : await tx.companyContractPrice.findMany({ where: { itemSizeId: { in: sizeIds } }, select: { id: true } });
    const where: Prisma.CatalogAuditLogWhereInput = { officeBranchId, OR: [
      ...(item ? [{ entityType: 'ITEM', entityId: item.id }] : []),
      ...(kind !== 'ITEM_PRICE' ? [{ entityType: 'ITEM_SIZE', entityId: { in: sizeIds } }] : []),
      { entityType: 'ITEM_PRICE', entityId: { in: prices.map(row => row.id) } },
      { entityType: 'COMPANY_CONTRACT_PRICE', entityId: { in: contractPrices.map(row => row.id) } },
    ] };
    const records = await tx.catalogAuditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (input.page - 1) * input.limit, take: input.limit });
    const total = await tx.catalogAuditLog.count({ where });
    return {
      entityType: kind, entityId: kind === 'ITEM_PRICE' ? prices[0].id : id,
      history: records.map(record => {
        const before = snapshot(record.before), after = snapshot(record.after);
        const fields = Object.keys(labels).filter(field => field in before || field in after);
        return {
          id: record.id, entityType: record.entityType, entityId: record.entityId,
          action: record.action, actionLabel: actions[record.action] ?? record.action, version: record.version,
          changedBy: { id: record.createdById, name: record.createdByName }, changedAt: record.createdAt,
          changes: fields.flatMap(field => {
            const previous = before[field] ?? null, current = after[field] ?? null;
            return record.action === 'CREATE' || JSON.stringify(previous) !== JSON.stringify(current)
              ? [{ field, label: labels[field], before: previous, after: current }] : [];
          }),
        };
      }),
      pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) },
    };
  }, { isolationLevel: 'RepeatableRead' }),
};
