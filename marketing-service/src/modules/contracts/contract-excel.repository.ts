import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AuditActor } from '../../types/auth.types.js';
import { buildListQuery, defineSortRules } from '../../utils/listQuery.js';
import { lockCompanyBranch } from '../../utils/companyAudit.js';
import { recordCatalogAudit, requireCatalogVersion } from '../../utils/catalogAudit.js';
import { HttpError } from '../../utils/httpError.js';
import { ExcelImportError, ExcelPriceRow, ExportItemSizesInput, MAX_EXCEL_ROWS } from './contract-excel.schemas.js';

export const contractExcelRepository = {
  exportSizes: async (input: ExportItemSizesInput, branch: string) => {
    const query = buildListQuery<'size', ExportItemSizesInput & { page: number; limit: number }, Prisma.ItemSizeWhereInput, Prisma.ItemSizeOrderByWithRelationInput>(
      { ...input, page: 1, limit: MAX_EXCEL_ROWS + 1 }, {
        baseWhere: { isActive: true, item: { officeBranchId: branch, isActive: true, service: { officeBranchId: branch, isActive: true } } },
        filters: {
          itemId: value => ({ itemId: value }), notIn: value => ({ id: { notIn: value } }),
          size: value => ({ size: { contains: value, mode: 'insensitive' } }),
          itemName: value => ({ item: { name: { contains: value, mode: 'insensitive' } } }),
          serviceName: value => ({ item: { service: { name: { contains: value, mode: 'insensitive' } } } }),
        }, defaultSort: { createdAt: 'desc' },
        sorts: defineSortRules<'size', Prisma.ItemSizeOrderByWithRelationInput>({ size: direction => ({ size: direction }) }),
      },
    );
    const sizes = await prisma.itemSize.findMany({ ...query, orderBy: [query.orderBy, { id: 'asc' }], include: {
      item: { include: { service: true } },
      // Only normal/primary prices are read; no sister-company or contract price is exported.
      price: { select: { version: true, isActive: true, effectiveFrom: true, effectiveUntil: true, priceServicePrimary: true, priceMaintenancePrimary: true } },
    } });
    if (sizes.length > MAX_EXCEL_ROWS) throw new HttpError(`Export exceeds ${MAX_EXCEL_ROWS} sizes; narrow the filters`, 400);
    return sizes;
  },
  importPrices: (contractId: string, companyId: string, version: number, rows: ExcelPriceRow[], branch: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const contract = await tx.companyContract.findFirst({ where: { id: contractId, companyId, company: { officeBranchId: branch, revoked: false } } });
    if (!contract) throw new HttpError('Company contract not found in the current branch', 404);
    requireCatalogVersion(contract, version);
    if (contract.status === 'EXPIRED' || contract.status === 'TERMINATED') throw new HttpError('Contract status does not allow price imports', 409);
    const now = new Date();
    if (contract.effectiveUntil && contract.effectiveUntil <= now) throw new HttpError('Cannot import prices into an expired contract', 409);
    const ids = rows.map(row => row.itemSizeId);
    const sizes = await tx.itemSize.findMany({ where: { id: { in: ids }, isActive: true, item: { officeBranchId: branch, isActive: true, service: { officeBranchId: branch, isActive: true } } }, include: { price: { select: { version: true } }, item: { include: { service: true } } } });
    const byId = new Map(sizes.map(size => [size.id, size]));
    const existing = new Set((await tx.companyContractPrice.findMany({ where: { contractId, itemSizeId: { in: ids } }, select: { itemSizeId: true } })).map(price => price.itemSizeId));
    const errors: ExcelImportError['errors'] = [];
    let stale = false;
    for (const row of rows) {
      const size = byId.get(row.itemSizeId);
      if (!size) { errors.push({ row: row.row, message: 'Size is missing, inactive or outside the current branch' }); continue; }
      if (size.version !== row.sizeVersion || (size.price?.version ?? null) !== row.priceVersion) {
        stale = true; errors.push({ row: row.row, message: 'Size or normal price changed after export; download a new template' });
      }
      if (size.item.service.hasMaintenance && row.priceMaintenance === null) errors.push({ row: row.row, field: 'Harga Maintenance', message: 'Maintenance price is required for this service' });
      if (existing.has(row.itemSizeId)) { stale = true; errors.push({ row: row.row, message: 'This size already has a price in this contract; import only creates new prices' }); }
    }
    if (errors.length) throw new ExcelImportError(errors, stale ? 409 : 400);
    const metadata = { createdAt: now, updatedAt: now, createdById: actor.id, createdByName: actor.name, updatedById: null, updatedByName: null, version: 0 };
    const prices = rows.map(row => ({ id: randomUUID(), contractId, itemSizeId: row.itemSizeId,
      priceService: new Prisma.Decimal(row.priceService), priceMaintenance: row.priceMaintenance === null ? null : new Prisma.Decimal(row.priceMaintenance),
      isActive: true, effectiveFrom: now, effectiveUntil: null, ...metadata,
    }));
    await tx.companyContractPrice.createMany({ data: prices });
    const audit = (entityType: string, before: unknown, after: { id: string; version: number }, action: string) => ({
      officeBranchId: branch, entityType, entityId: after.id, version: after.version, action,
      before: before === null ? Prisma.DbNull : JSON.parse(JSON.stringify(before)), after: JSON.parse(JSON.stringify(after)),
      createdById: actor.id, createdByName: actor.name,
    });
    const changes = { updatedAt: now, updatedById: actor.id, updatedByName: actor.name };
    await tx.itemSize.updateMany({ where: { id: { in: ids } }, data: { ...changes, version: { increment: 1 } } });
    const items = [...new Map(sizes.map(size => [size.itemId, size.item])).values()];
    await tx.item.updateMany({ where: { id: { in: items.map(item => item.id) } }, data: { ...changes, version: { increment: 1 } } });
    await tx.catalogAuditLog.createMany({ data: [
      ...prices.map(price => audit('COMPANY_CONTRACT_PRICE', null, price, 'IMPORT')),
      ...sizes.map(({ item, price, ...size }) => audit('ITEM_SIZE', size, { ...size, ...changes, version: size.version + 1 }, 'PRICE_UPDATE')),
      ...items.map(({ service, ...item }) => audit('ITEM', item, { ...item, ...changes, version: item.version + 1 }, 'CHILD_UPDATE')),
    ] });
    const updated = await tx.companyContract.update({ where: { id: contractId, version }, data: { ...changes, version: { increment: 1 } } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', contract, updated, actor, 'IMPORT');
    return { companyId, contractId, version: updated.version, imported: prices.length };
  }, { maxWait: 10000, timeout: 30000 }),
};
