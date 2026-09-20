import { Prisma } from '@prisma/client';
import { currentBusinessDate } from '../../utils/businessDate.js';
import { HttpError } from '../../utils/httpError.js';
import type { ListItemSizesInput } from './item.schemas.js';

export const priceContext = async (tx: Prisma.TransactionClient, companyId: string, branch: string, now: Date) => {
  const company = await tx.company.findFirst({ where: { id: companyId, officeBranchId: branch, revoked: false } });
  if (!company) throw new HttpError('Company not found', 404);
  const today = currentBusinessDate(now);
  const contracts = await tx.companyContract.findMany({ where: { companyId, status: 'APPROVED', effectiveFrom: { lte: today }, effectiveUntil: { gt: today } }, take: 2 });
  if (contracts.length > 1) throw new HttpError('Multiple current contracts found', 409);
  return { company, contract: contracts.length ? contracts[0] : null };
};
export const standardPriceContext = async (tx: Prisma.TransactionClient, companyId: string, branch: string) => {
  const company = await tx.company.findFirst({ where: { id: companyId, officeBranchId: branch, revoked: false } });
  if (!company) throw new HttpError('Company not found', 404);
  return { company, contract: null };
};
export type PriceContext = Awaited<ReturnType<typeof priceContext>>;
export const quotationSizeInclude = {
  price: true, contractPrices: true, item: { include: { service: true } },
} satisfies Prisma.ItemSizeInclude;
type Size = Prisma.ItemSizeGetPayload<{ include: { price: true; item: { include: { service: true } } } }>;
const validPrice = (price: { isActive: boolean; effectiveFrom: Date; effectiveUntil: Date | null } | null | undefined, now: Date) =>
  !!price && price.isActive && price.effectiveFrom <= now && (price.effectiveUntil === null || price.effectiveUntil > now);

export const catalogSnapshot = (row: { size: string | null; item: { name: string; service: { name: string; type: string; hasMaintenance: boolean } | null } }) => {
  const service = row.item.service;
  const serviceName = service?.name ?? row.item.name;
  const serviceType = service?.type ?? 'OTHER';
  const hasMaintenance = service?.hasMaintenance ?? false;
  return { serviceName, serviceType, itemName: row.item.name, size: row.size, hasMaintenance };
};
export const resolveQuotationPrice = (row: Size, context: PriceContext, now: Date) => {
  const service = row.item.service;
  const catalogActive = row.isActive && row.item.isActive && (!service || service.isActive);
  const source = context.company.isSisterCompany ? 'SISTER_COMPANY' : 'PRIMARY';
  const selected = row.price;
  const available = catalogActive && validPrice(selected, now);
  const priceService = !available ? null : source === 'SISTER_COMPANY' ? selected!.priceServiceSisterCompany : selected!.priceServicePrimary;
  const priceMaintenance = !available ? null : source === 'SISTER_COMPANY' ? selected!.priceMaintenanceSisterCompany : selected!.priceMaintenancePrimary;
  const snapshot = catalogSnapshot(row);
  return {
    catalogSnapshot: snapshot, catalogActive, contractPrice: null, contractId: null, contractVersion: null,
    priceSource: source, priceId: selected?.id ?? null, priceVersion: selected?.version ?? null,
    sizeVersion: row.version, itemVersion: row.item.version, serviceVersion: service?.version ?? null,
    priceStatus: priceService === null ? 'UNAVAILABLE' : 'AVAILABLE',
    priceMessage: priceService === null ? 'Normal/sister price or active catalog is unavailable' : null,
    priceService, priceInspection: priceService, priceMaintenance: snapshot.hasMaintenance ? priceMaintenance : null,
  };
};

export const quotationOptions = async (tx: Prisma.TransactionClient, input: ListItemSizesInput, context: PriceContext, branch: string, now: Date) => {
  const contractId = context.contract?.id ?? '00000000-0000-0000-0000-000000000000';
  const sizeLabel = Prisma.sql`s.size`;
  const itemLabel = Prisma.sql`i.name`;
  const serviceLabel = Prisma.sql`COALESCE(svc.name, i.name)`;
  const serviceNameFilter = input.serviceName ? Prisma.sql`AND strpos(lower(${serviceLabel}), lower(${input.serviceName})) > 0` : Prisma.empty;
  const from = Prisma.sql`FROM item_sizes s
    JOIN items i ON i.id = s.item_id
    LEFT JOIN services svc ON svc.id = i.service_id
    LEFT JOIN company_contract_prices cp ON cp.item_size_id = s.id AND cp.contract_id = ${contractId}::uuid
    WHERE i.office_branch_id = ${branch}::uuid
      AND s.is_active AND i.is_active AND (svc.id IS NULL OR svc.is_active) AND cp.id IS NULL
      ${input.itemId ? Prisma.sql`AND i.id = ${input.itemId}::uuid` : Prisma.empty}
      ${input.notIn?.length ? Prisma.sql`AND s.id::text NOT IN (${Prisma.join(input.notIn)})` : Prisma.empty}
      ${input.size ? Prisma.sql`AND strpos(lower(${sizeLabel}), lower(${input.size})) > 0` : Prisma.empty}
      ${input.itemName ? Prisma.sql`AND strpos(lower(${itemLabel}), lower(${input.itemName})) > 0` : Prisma.empty}
      ${serviceNameFilter}`;
  const order = input.sortBy === 'size'
    ? Prisma.sql`${sizeLabel} ${input.sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`}`
    : Prisma.sql`s.created_at DESC`;
  const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT s.id ${from} ORDER BY ${order}, s.id ASC LIMIT ${input.limit} OFFSET ${(input.page - 1) * input.limit}`);
  const [count] = await tx.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total ${from}`);
  const rows = await tx.itemSize.findMany({ where: { id: { in: ids.map(row => row.id) } }, include: {
    ...quotationSizeInclude, contractPrices: { where: { contractId } },
  } });
  const byId = new Map(rows.map(row => [row.id, row]));
  const sizes = ids.map(({ id }) => {
    const row = byId.get(id)!;
    const selected = resolveQuotationPrice(row, context, now);
    const identity = selected.catalogSnapshot;
    return {
      id: row.id, itemId: row.itemId, size: identity.size, version: row.version,
      isActive: row.isActive, createdAt: row.createdAt, updatedAt: row.updatedAt,
      ...selected,
      item: { id: row.item.id, name: identity.itemName, version: row.item.version,
        service: row.item.service ? { id: row.item.service.id, name: identity.serviceName, type: identity.serviceType, hasMaintenance: identity.hasMaintenance, version: row.item.service.version } : null },
    };
  });
  const total = Number(count.total);
  return { company: { id: context.company.id, name: context.company.name, isSisterCompany: context.company.isSisterCompany }, sizes,
    pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) } };
};
