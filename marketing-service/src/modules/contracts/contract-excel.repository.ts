import { catalogSnapshot } from '../items/quotation-price.js';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AuditActor } from '../../types/auth.types.js';
import { buildListQuery, defineSortRules } from '../../utils/listQuery.js';
import { lockCompanyBranch } from '../../utils/companyAudit.js';
import { recordCatalogAudit, requireCatalogVersion } from '../../utils/catalogAudit.js';
import { HttpError } from '../../utils/httpError.js';
import { currentBusinessDate } from '../../utils/businessDate.js';
import { ExcelImportError, ExcelPriceRow, ExportItemSizesInput, MAX_EXCEL_ROWS } from './contract-excel.schemas.js';

export const contractExcelRepository = {
  exportSizes: async (input: ExportItemSizesInput, branch: string) => {
    const query = buildListQuery<'size', ExportItemSizesInput & { page: number; limit: number }, Prisma.ItemSizeWhereInput, Prisma.ItemSizeOrderByWithRelationInput>(
      { ...input, page: 1, limit: MAX_EXCEL_ROWS + 1 }, {
        baseWhere: { isActive: true, item: { officeBranchId: branch, isActive: true } },
        filters: {
          itemId: value => ({ itemId: value }), notIn: value => ({ id: { notIn: value } }),
          size: value => ({ size: { contains: value, mode: 'insensitive' } }),
          itemName: value => ({ item: { name: { contains: value, mode: 'insensitive' } } }),
          serviceName: value => ({ item: { service: { name: { contains: value, mode: 'insensitive' } } } }),
        }, defaultSort: { createdAt: 'desc' },
        sorts: defineSortRules<'size', Prisma.ItemSizeOrderByWithRelationInput>({ size: direction => ({ size: direction }) }),
      },
    );
    // PostgreSQL ASC places missing service names last.
    const sizes = await prisma.itemSize.findMany({ ...query, orderBy: input.sortBy ? [query.orderBy, { id: 'asc' }] : [{ item: { service: { name: 'asc' } } }, { item: { name: 'asc' } }, { size: 'asc' }, { id: 'asc' }], include: {
      item: { include: { service: true } },
      // Only normal/primary prices are read; no sister-company or contract price is exported.
      price: { select: { isActive: true, effectiveFrom: true, effectiveUntil: true, priceServicePrimary: true, priceMaintenancePrimary: true } },
    } });
    if (sizes.length > MAX_EXCEL_ROWS) throw new HttpError(`Export exceeds ${MAX_EXCEL_ROWS} sizes; narrow the filters`, 400);
    const ordered = [...sizes].sort((left, right) => {
      const leftService = left.item.service?.name;
      const rightService = right.item.service?.name;
      if (!leftService && rightService) return 1;
      if (leftService && !rightService) return -1;
      const serviceCompare = (leftService ?? '').localeCompare(rightService ?? '', undefined, { sensitivity: 'base' });
      if (serviceCompare) return serviceCompare;
      const itemCompare = left.item.name.localeCompare(right.item.name, undefined, { sensitivity: 'base' });
      if (itemCompare) return itemCompare;
      const sizeCompare = (left.size ?? '').localeCompare(right.size ?? '', undefined, { sensitivity: 'base' });
      return sizeCompare || left.id.localeCompare(right.id);
    });
    return ordered;
  },
  importPrices: (contractId: string, companyId: string, version: number, rows: ExcelPriceRow[], branch: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const requestedContract = await tx.companyContract.findFirst({ where: { id: contractId, companyId, company: { officeBranchId: branch, revoked: false } } });
    if (!requestedContract) throw new HttpError('Company contract not found in the current branch', 404);
    const now = new Date();
    const today = currentBusinessDate(now);
    const contractValidity = { status: 'ACTIVE' as const, isActive: true, companyId, effectiveUntil: { gt: today }, company: { officeBranchId: branch, revoked: false } };
    // Prefer the contract valid today. If there is no current contract, import into the earliest future contract.
    const contract = await tx.companyContract.findFirst({
      where: { ...contractValidity, effectiveFrom: { lte: today } },
      orderBy: [{ effectiveFrom: 'desc' }, { id: 'asc' }],
    }) ?? await tx.companyContract.findFirst({
      where: { ...contractValidity, effectiveFrom: { gt: today } },
      orderBy: [{ effectiveFrom: 'asc' }, { id: 'asc' }],
    });
    if (!contract) throw new HttpError('No active or future contract is available for price imports', 409);
    requireCatalogVersion(contract, version);
    const targetContractId = contract.id;
    const ids = rows.map(row => row.itemSizeId);
    const sizes = await tx.itemSize.findMany({ where: { id: { in: ids }, isActive: true, item: { officeBranchId: branch, isActive: true } }, include: { item: { include: { service: true } } } });
    const byId = new Map(sizes.map(size => [size.id, size]));
    const existing = new Set((await tx.companyContractPrice.findMany({ where: { contractId: targetContractId, itemSizeId: { in: ids } }, select: { itemSizeId: true } })).map(price => price.itemSizeId));
    const errors: ExcelImportError['errors'] = [];
    let stale = false;
    for (const row of rows) {
      const size = byId.get(row.itemSizeId);
      if (!size) { errors.push({ row: row.row, message: 'Size is missing, inactive or outside the current branch' }); continue; }
      if (size.version !== row.sizeVersion) {
        stale = true; errors.push({ row: row.row, message: 'Size changed after export; download a new template' });
      }
      if (size.item.service?.hasMaintenance && row.priceMaintenance === null) errors.push({ row: row.row, field: 'Maintenance Price', message: 'Maintenance price is required for this service' });
      if (existing.has(row.itemSizeId)) { stale = true; errors.push({ row: row.row, message: 'This size already has a price in this contract; use the contract price PUT endpoint to update it' }); }
    }
    if (errors.length) throw new ExcelImportError(errors, stale ? 409 : 400);
    const metadata = { createdAt: now, updatedAt: now, createdById: actor.id, createdByName: actor.name, updatedById: null, updatedByName: null, version: 0 };
    const prices = rows.map(row => ({ id: randomUUID(), contractId: targetContractId, itemSizeId: row.itemSizeId, catalogSnapshot: catalogSnapshot(byId.get(row.itemSizeId)!),
      priceService: new Prisma.Decimal(row.priceService), priceMaintenance: row.priceMaintenance === null ? null : new Prisma.Decimal(row.priceMaintenance),
      isActive: true, effectiveFrom: now, effectiveUntil: null, ...metadata,
    }));
    await tx.companyContractPrice.createMany({ data: prices });
    const audit = (entityType: string, before: unknown, after: { id: string; version: number }, action: string) => ({
      officeBranchId: branch, entityType, entityId: after.id, version: after.version, action,
      before: before === null ? Prisma.DbNull : JSON.parse(JSON.stringify(before)), after: JSON.parse(JSON.stringify(after)),
      createdById: actor.id, createdByName: actor.name,
    });
    await tx.catalogAuditLog.createMany({ data: [
      ...prices.map(price => audit('COMPANY_CONTRACT_PRICE', null, price, 'IMPORT')),
    ] });
    const updated = await tx.companyContract.update({ where: { id: targetContractId, version: contract.version }, data: { updatedAt: now, updatedById: actor.id, version: { increment: 1 } } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', contract, updated, actor, 'IMPORT');
    await tx.companyContractHistory.create({ data: {
      companyContractId: updated.id, version: updated.version, action: 'IMPORT',
      snapshot: JSON.parse(JSON.stringify(updated)), createdById: actor.id, createdByName: actor.name,
    } });
    return { companyId, contractId: targetContractId, version: updated.version, imported: prices.length };
  }, { maxWait: 10000, timeout: 30000 }),
};
