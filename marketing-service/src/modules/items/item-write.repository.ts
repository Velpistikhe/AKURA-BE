import { catalogSnapshot } from './quotation-price.js';
import { UpdateItemInput } from './item.schemas.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AuditActor } from '../../types/auth.types.js';
import { HttpError } from '../../utils/httpError.js';
import { lockCompanyBranch } from '../../utils/companyAudit.js';
import { CatalogEntity, recordCatalogAudit, requireCatalogVersion } from '../../utils/catalogAudit.js';
import { AddItemSizeInput, CreateItemInput, PriceInput, ContractPriceInput, createItemPriceSchema, createContractPriceSchema, referenceKey, UpdatePriceInput } from './item.schemas.js';

type Tx = Prisma.TransactionClient;
// One shared lock order for catalog writes and company revision/copy operations.
const write = <T>(branch: string, action: (tx: Tx) => Promise<T>) => prisma.$transaction(async tx => {
  await lockCompanyBranch(tx, branch);
  return action(tx);
}, { maxWait: 10000, timeout: 20000 }).catch(error => {
  if (error?.code === 'P2002') throw new HttpError('An active item, size or price with this key already exists', 409);
  if (error?.code === 'P2025' || error?.code === 'P2034') throw new HttpError('Data has changed; reload before retrying', 409);
  throw error;
});
const createdBy = (actor: AuditActor) => ({ createdById: actor.id, createdByName: actor.name });
const updatedBy = (actor: AuditActor) => ({ updatedById: actor.id, updatedByName: actor.name, version: { increment: 1 } });
const contractUpdatedBy = (actor: AuditActor) => ({ updatedById: actor.id, version: { increment: 1 } });
type ItemCatalogEntity = Exclude<CatalogEntity, 'SERVICE' | 'SERVICE_SCOPE' | 'MAINTENANCE_SCOPE'>;
const delegates = { ITEM: 'item', ITEM_SIZE: 'itemSize', ITEM_PRICE: 'itemPrice', COMPANY_CONTRACT_PRICE: 'companyContractPrice', COMPANY_CONTRACT: 'companyContract' } as const;
const change = async (tx: Tx, branch: string, entity: ItemCatalogEntity, before: any, data: any, actor: AuditActor, action = 'UPDATE') => {
  const delegate = tx[delegates[entity]] as any;
  const after = await delegate.update({ where: { id: before.id, version: before.version }, data: {
    ...data, ...(entity === 'COMPANY_CONTRACT' ? contractUpdatedBy(actor) : updatedBy(actor)),
  } });
  await recordCatalogAudit(tx, branch, entity, before, after, actor, action);
  if (entity === 'COMPANY_CONTRACT') await tx.companyContractHistory.create({ data: {
    companyContractId: after.id, version: after.version, action,
    snapshot: JSON.parse(JSON.stringify(after)), createdById: actor.id, createdByName: actor.name,
  } });
  return after;
};
const itemInBranch = async (tx: Tx, id: string, branch: string) => {
  const item = await tx.item.findFirst({ where: { id, officeBranchId: branch, service: { officeBranchId: branch } }, include: { service: true } });
  if (!item) throw new HttpError('Item not found', 404);
  if (!item.service.isActive) throw new HttpError('Service is inactive', 409);
  if (!item.isActive) throw new HttpError('Item is inactive', 409);
  return item;
};
const sizeInBranch = async (tx: Tx, id: string, branch: string) => {
  const size = await tx.itemSize.findFirst({ where: { id, item: { officeBranchId: branch } } });
  if (!size) throw new HttpError('Item size not found', 404);
  const item = await itemInBranch(tx, size.itemId, branch);
  if (!size.isActive) throw new HttpError('Item size is inactive', 409);
  return { size, item };
};
const standardPrices = (input: PriceInput, hasMaintenance: boolean) => {
  const parsed = createItemPriceSchema.safeParse(input);
  if (!parsed.success) throw new HttpError('Service prices are required and all prices must be nonnegative with at most two decimals', 400);
  if (hasMaintenance && (input.priceMaintenancePrimary == null || input.priceMaintenanceSisterCompany == null)) {
    throw new HttpError('Both maintenance prices are required for a service with maintenance', 400);
  }
  return parsed.data;
};
const contractInBranch = async (tx: Tx, id: string, branch: string) => {
  const contract = await tx.companyContract.findFirst({ where: { id, isActive: true, company: { officeBranchId: branch, revoked: false } } });
  if (!contract) throw new HttpError('Active company contract not found', 404);
  if (contract.status === 'EXPIRED' || contract.status === 'TERMINATED') throw new HttpError('Contract status does not allow price changes', 409);
  return contract;
};
const contractPrices = (input: ContractPriceInput, hasMaintenance: boolean) => {
  const parsed = createContractPriceSchema.safeParse(input);
  if (!parsed.success) throw new HttpError('Contract service price is required and prices must be nonnegative with at most two decimals', 400);
  if (hasMaintenance && input.priceMaintenance == null) throw new HttpError('Contract maintenance price is required', 400);
  return parsed.data;
};
const bumpItem = async (tx: Tx, branch: string, item: any, actor: AuditActor) => {
  const { service, ...row } = item;
  return change(tx, branch, 'ITEM', row, {}, actor, 'CHILD_UPDATE');
};
const bumpSize = async (tx: Tx, branch: string, size: any, item: any, actor: AuditActor) => {
  await change(tx, branch, 'ITEM_SIZE', size, {}, actor, 'PRICE_UPDATE');
  await bumpItem(tx, branch, item, actor);
};
const insertSize = async (tx: Tx, branch: string, item: any, input: CreateItemInput['sizes'][number], actor: AuditActor) => {
  const { size } = input;
  // Keep direct-price items separate from items with named sizes. Retain this
  // distinction after soft deletion so removing a variant cannot bypass it.
  if (await tx.itemSize.findFirst({ where: { itemId: item.id, size: null, ...(size === null ? { isActive: true } : {}) } })) {
    throw new HttpError('This item uses direct pricing and cannot have additional sizes', 409);
  }
  if (size === null && await tx.itemSize.findFirst({ where: { itemId: item.id, size: { not: null } } })) {
    throw new HttpError('An item with named sizes cannot use direct pricing', 409);
  }
  // Empty key is reserved for the single active variant without a size.
  // Named sizes are normalized nonempty strings; null keys release inactive variants.
  const activeKey = size === null ? '' : referenceKey(size);
  if (await tx.itemSize.findFirst({ where: { itemId: item.id, isActive: true, OR: [{ activeKey }, { size: { equals: size, mode: 'insensitive' } }] } })) throw new HttpError('Item size already exists', 409);
  const latest = await tx.itemSize.findFirst({ where: { itemId: item.id, size }, orderBy: { effectiveFrom: 'desc' } });
  const effectiveFrom = new Date(Math.max(Date.now(), latest ? latest.effectiveFrom.getTime() + 1 : 0));
  const row = await tx.itemSize.create({ data: { itemId: item.id, size, activeKey, effectiveFrom, ...createdBy(actor) } });
  await recordCatalogAudit(tx, branch, 'ITEM_SIZE', null, row, actor, 'CREATE');
  return { ...row, price: null };
};
// The branch transaction lock also covers contract/Excel writers. Read once, mutate in
// batches, and append one immutable snapshot per changed row in the same transaction.
const closeSizes = async (tx: Tx, branch: string, sizes: Prisma.ItemSizeGetPayload<{}>[], actor: AuditActor) => {
  if (!sizes.length) return;
  const ids = sizes.map(size => size.id);
  const prices = await tx.itemPrice.findMany({ where: { itemSizeId: { in: ids }, isActive: true } });
  const changedAt = new Date(Math.max(Date.now(), ...[...sizes, ...prices].map(row => row.effectiveFrom.getTime())));
  const metadata = { updatedAt: changedAt, updatedById: actor.id, updatedByName: actor.name };
  const closed = { ...metadata, isActive: false, effectiveUntil: changedAt };
  const rows = <T extends { id: string; version: number }>(entityType: ItemCatalogEntity, before: T[], updates: object, action: string) => before.map(row => ({
    officeBranchId: branch, entityType, entityId: row.id, version: row.version + 1, action,
    before: JSON.parse(JSON.stringify(row)), after: JSON.parse(JSON.stringify({ ...row, ...updates, version: row.version + 1 })),
    createdById: actor.id, createdByName: actor.name,
  }));
  await tx.itemPrice.updateMany({ where: { id: { in: prices.map(price => price.id) } }, data: { ...closed, version: { increment: 1 } } });
  await tx.itemSize.updateMany({ where: { id: { in: ids } }, data: { ...closed, activeKey: null, version: { increment: 1 } } });
  const audits = [
    ...rows('ITEM_PRICE', prices, closed, 'DEACTIVATE'),
    ...rows('ITEM_SIZE', sizes, { ...closed, activeKey: null }, 'DEACTIVATE'),
  ];
  // Bound each insert's parameter count for large catalogs.
  for (let offset = 0; offset < audits.length; offset += 500) await tx.catalogAuditLog.createMany({ data: audits.slice(offset, offset + 500) });

};

const createContract = async (tx: Tx, id: string, data: ContractPriceInput, branch: string, actor: AuditActor) => {
    const { size, item } = await sizeInBranch(tx, id, branch);
    const contract = await contractInBranch(tx, data.contractId, branch);
    const prices = contractPrices(data, item.service.hasMaintenance);
    if (await tx.companyContractPrice.findFirst({ where: { contractId: data.contractId, itemSizeId: id } })) {
      throw new HttpError('Contract price already exists; use PATCH with its version', 409);
    }
    const result = await tx.companyContractPrice.create({ data: { itemSizeId: id, ...prices, catalogSnapshot: catalogSnapshot({ ...size, item }), ...createdBy(actor) } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT_PRICE', null, result, actor, 'CREATE');
    await change(tx, branch, 'COMPANY_CONTRACT', contract, {}, actor, 'PRICE_UPDATE');
    await bumpSize(tx, branch, size, item, actor);
    return result;
};
const changeContract = async (tx: Tx, id: string, data: { version: number; priceService?: string | number; priceMaintenance?: string | number | null; isActive?: boolean }, branch: string, actor: AuditActor, remove = false) => {
    const before = await tx.companyContractPrice.findFirst({ where: { id, contract: { company: { officeBranchId: branch, revoked: false } } } });
    if (!before) throw new HttpError('Contract price not found', 404);
    const { size, item } = await sizeInBranch(tx, before.itemSizeId, branch);
    requireCatalogVersion(before, data.version);
    const contract = await contractInBranch(tx, before.contractId, branch);
    const prices = remove ? {} : contractPrices({ contractId: before.contractId, priceService: data.priceService!, priceMaintenance: data.priceMaintenance }, item.service.hasMaintenance);
    const active = remove ? false : data.isActive ?? before.isActive;
    const result = await change(tx, branch, 'COMPANY_CONTRACT_PRICE', before, {
      ...prices, isActive: active, effectiveUntil: active ? null : new Date(Math.max(Date.now(), before.effectiveFrom.getTime())),
      ...(!before.isActive && active ? { effectiveFrom: new Date() } : {}),
    }, actor, remove ? 'DEACTIVATE' : 'UPDATE');
    await change(tx, branch, 'COMPANY_CONTRACT', contract, {}, actor, 'PRICE_UPDATE');
    await bumpSize(tx, branch, size, item, actor);
    return result;
};

export const itemWriteRepository = {
  create: (data: CreateItemInput, branch: string, actor: AuditActor) => write(branch, async tx => {
    const service = await tx.service.findFirst({ where: { id: data.serviceId, officeBranchId: branch, isActive: true } });
    if (!service) throw new HttpError('Service is inactive or not found', 409);
    const activeKey = referenceKey(data.name);
    if (await tx.item.findFirst({ where: { serviceId: data.serviceId, isActive: true, OR: [{ activeKey }, { name: { equals: data.name, mode: 'insensitive' } }] } })) throw new HttpError('Item already exists for this service', 409);
    const item = await tx.item.create({ data: { officeBranchId: branch, serviceId: data.serviceId, name: data.name, uom: data.uom, activeKey, ...createdBy(actor) } });
    await recordCatalogAudit(tx, branch, 'ITEM', null, item, actor, 'CREATE');
    const sizes = [];
    for (const size of data.sizes.length ? data.sizes : [{ size: null }]) sizes.push(await insertSize(tx, branch, { ...item, service }, size, actor));
    return { ...item, sizes };
  }),
  addSize: (data: AddItemSizeInput, branch: string, actor: AuditActor) => write(branch, async tx => {
    const item = await itemInBranch(tx, data.itemId, branch);
    requireCatalogVersion(item, data.itemVersion);
    const { itemId, itemVersion, ...input } = data;
    const size = await insertSize(tx, branch, item, input, actor);
    const parent = await bumpItem(tx, branch, item, actor);
    return { ...size, itemVersion: parent.version };
  }),
  updateItem: (id: string, data: UpdateItemInput, branch: string, actor: AuditActor) => write(branch, async tx => {
    const item = await itemInBranch(tx, id, branch);
    requireCatalogVersion(item, data.version);
    const { service, ...before } = item;
    const updates: Prisma.ItemUpdateInput = {};
    if (data.name !== undefined) {
      const activeKey = referenceKey(data.name);
      if (await tx.item.findFirst({ where: { serviceId: item.serviceId, isActive: true, id: { not: id }, OR: [{ activeKey }, { name: { equals: data.name, mode: 'insensitive' } }] } })) throw new HttpError('Item already exists for this service', 409);
      updates.name = data.name;
      updates.activeKey = activeKey;
    }
    if (data.uom !== undefined) updates.uom = data.uom;
    return change(tx, branch, 'ITEM', before, updates, actor);
  }),
  removeSize: (id: string, branch: string, actor: AuditActor, version: number) => write(branch, async tx => {
    const { size, item } = await sizeInBranch(tx, id, branch);
    requireCatalogVersion(size, version);
    await closeSizes(tx, branch, [size], actor);
    await bumpItem(tx, branch, item, actor);
    return tx.itemSize.findUniqueOrThrow({ where: { id }, include: { price: true } });
  }),
  remove: (id: string, branch: string, actor: AuditActor, version: number) => write(branch, async tx => {
    const item = await itemInBranch(tx, id, branch);
    requireCatalogVersion(item, version);
    await closeSizes(tx, branch, await tx.itemSize.findMany({ where: { itemId: id, isActive: true } }), actor);
    const { service, ...before } = item;
    await change(tx, branch, 'ITEM', before, { isActive: false, activeKey: null }, actor, 'DEACTIVATE');
    return tx.item.findUniqueOrThrow({ where: { id }, include: { sizes: { include: { price: true } } } });
  }),
  savePrice: (id: string, data: PriceInput | UpdatePriceInput, branch: string, actor: AuditActor, create = false) => write(branch, async tx => {
    const { size, item } = await sizeInBranch(tx, id, branch);
    const { version, isActive, ...input } = data as Partial<UpdatePriceInput>;
    const before = await tx.itemPrice.findUnique({ where: { itemSizeId: id } });
    let result;
    if (create) {
      if (before) throw new HttpError('Price already exists; use PATCH with its version', 409);
      const prices = standardPrices(input as PriceInput, item.service.hasMaintenance);
      result = await tx.itemPrice.create({ data: { itemSizeId: id, ...prices, ...createdBy(actor) } });
      await recordCatalogAudit(tx, branch, 'ITEM_PRICE', null, result, actor, 'CREATE');
    } else {
      if (!before) throw new HttpError('Item price not found', 404);
      requireCatalogVersion(before, version!);
      const prices = standardPrices({ priceServicePrimary: before.priceServicePrimary.toString(), priceServiceSisterCompany: before.priceServiceSisterCompany.toString(), priceMaintenancePrimary: before.priceMaintenancePrimary?.toString() ?? null, priceMaintenanceSisterCompany: before.priceMaintenanceSisterCompany?.toString() ?? null, ...input }, item.service.hasMaintenance);
      result = await change(tx, branch, 'ITEM_PRICE', before, { ...prices, ...(isActive === undefined ? {} : { isActive, effectiveUntil: isActive ? null : new Date(Math.max(Date.now(), before.effectiveFrom.getTime())), ...(!before.isActive && isActive ? { effectiveFrom: new Date() } : {}) }) }, actor);
    }
    await bumpSize(tx, branch, size, item, actor);
    return result;
  }),
  removePrice: (id: string, version: number, branch: string, actor: AuditActor) => write(branch, async tx => {
    const { size, item } = await sizeInBranch(tx, id, branch);
    const before = await tx.itemPrice.findUnique({ where: { itemSizeId: id } });
    if (!before) throw new HttpError('Item price not found', 404);
    requireCatalogVersion(before, version);
    const result = await change(tx, branch, 'ITEM_PRICE', before, { isActive: false, effectiveUntil: new Date(Math.max(Date.now(), before.effectiveFrom.getTime())) }, actor, 'DEACTIVATE');
    await bumpSize(tx, branch, size, item, actor);
    return result;
  }),
  createContract: (id: string, data: ContractPriceInput, branch: string, actor: AuditActor) => write(branch, tx => createContract(tx, id, data, branch, actor)),
  upsertContract: (id: string, data: ContractPriceInput & { version?: number }, branch: string, actor: AuditActor) => write(branch, async tx => {
    const existing = await tx.companyContractPrice.findFirst({ where: { contractId: data.contractId, itemSizeId: id, contract: { company: { officeBranchId: branch, revoked: false } } }, select: { id: true } });
    if (!existing) {
      if (data.version !== undefined) throw new HttpError('Contract price no longer exists; reload before retrying', 409);
      const { version, ...input } = data;
      return { created: true, price: await createContract(tx, id, input, branch, actor) };
    }
    if (data.version === undefined) throw new HttpError('version is required when updating an existing contract price', 400);
    return { created: false, price: await changeContract(tx, existing.id, { ...data, version: data.version }, branch, actor) };
  }),
  changeContract: (id: string, data: { version: number; priceService?: string | number; priceMaintenance?: string | number | null; isActive?: boolean }, branch: string, actor: AuditActor, remove = false) => write(branch, tx => changeContract(tx, id, data, branch, actor, remove)),
};
