import { applicableTax } from '../taxes/tax-sync.js';
import { lockCompanyBranch } from '../../utils/companyAudit.js';
import { standardPriceContext, resolveQuotationPrice, quotationSizeInclude, PriceContext } from '../items/quotation-price.js';
import { Prisma, ServiceType } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AuditActor } from '../../types/auth.types.js';
import { HttpError } from '../../utils/httpError.js';
import { createQuotationSchema, updateQuotationSchema, deactivateQuotationSchema, QuotationItemInput, ListQuotationsInput } from './quotation.schemas.js';
import { buildPagination } from '../../utils/listQuery.js';
import { lockNextQuotationNumber, quotationDate, quotationNumberYear } from './quotation-number.js';
import type { QuotationPdfMetadata } from './quotation-approval.service.js';
import { serviceScopeInclude, serviceScopeSnapshot } from './quotation-service-groups.js';

const include = { pdfDocument: true, items: { orderBy: { position: 'asc' as const } } };
export const approvableStatuses = ['CREATED', 'SENT', 'REVISED'] as const;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const amount = (value: Prisma.Decimal) => {
  const rounded = value.toDecimalPlaces(2);
  if (rounded.greaterThan('9999999999999999.99')) throw new HttpError('Quotation amount exceeds supported precision', 400);
  return rounded;
};

async function customer(tx: Prisma.TransactionClient, companyId: string | undefined, staffId: string, officeBranchId: string) {
  const selectCompany = { id: true, version: true, name: true, type: true, address: true, npwp: true } as const;
  const staff = await tx.companyStaff.findFirst({ where: { id: staffId, revoked: false,
    ...(companyId ? { companyId } : {}), company: { officeBranchId, revoked: false } },
    select: { name: true, title: true, company: { select: selectCompany } } });
  if (!staff) throw new HttpError('Company staff not found in the selected company and branch', 404);
  return { customerSnapshot: staff.name, companySnapshot: json({ ...staff.company, staffTitle: staff.title }) };
}

async function newItem(tx: Prisma.TransactionClient, input: QuotationItemInput, officeBranchId: string, actor: AuditActor, position: number, context: PriceContext, now: Date) {
  const size = await tx.itemSize.findFirst({
    where: { id: input.itemSizeId, item: { officeBranchId } },
    include: { ...quotationSizeInclude, contractPrices: false, item: { include: { service: { include: serviceScopeInclude }, inspectionScopes: { where: { revoked: false } }, maintenanceScopes: { where: { revoked: false } } } } },
  });
  if (!size) throw new HttpError('Item size not found', 404);
  const service = size.item.service;
  const scopeSnapshot = service ? serviceScopeSnapshot(service) : {
    serviceId: null,
    serviceScopes: size.item.inspectionScopes.map(scope => scope.inspectionScope).concat(size.item.maintenanceScopes.map(scope => scope.scope)).join(', '),
    inspectionScopes: size.item.inspectionScopes.map(scope => scope.inspectionScope).join(', '),
    maintenanceScopes: size.item.maintenanceScopes.map(scope => scope.scope).join(', '),
  };
  const resolved = resolveQuotationPrice(size, context, now);
  const quantityInspection = new Prisma.Decimal(input.quantityInspection);
  const quantityMaintenance = new Prisma.Decimal(input.quantityMaintenance);
  if (resolved.priceStatus !== 'AVAILABLE' || resolved.priceService === null) throw new HttpError('Inspection price is unavailable for this company', 409);
  if (quantityMaintenance.greaterThan(0) && (!resolved.catalogSnapshot.hasMaintenance || resolved.priceMaintenance === null)) throw new HttpError('Maintenance is unavailable for this size and company', 409);
  const priceInspection = resolved.priceService;
  const priceMaintenance = resolved.catalogSnapshot.hasMaintenance ? resolved.priceMaintenance : null;
  return {
    itemSizeId: size.id, position, serviceName: resolved.catalogSnapshot.serviceName,
    serviceType: resolved.catalogSnapshot.serviceType as ServiceType, itemName: resolved.catalogSnapshot.itemName, size: resolved.catalogSnapshot.size,
    priceSelection: json({ ...scopeSnapshot, quantityModel: 'DUAL', priceSource: resolved.priceSource, priceId: resolved.priceId,
      priceVersion: resolved.priceVersion, contractId: resolved.contractId, contractVersion: resolved.contractVersion,
      sizeVersion: resolved.sizeVersion, itemVersion: resolved.itemVersion, serviceVersion: resolved.serviceVersion }),
    quantityInspection, quantityMaintenance, priceInspection, priceMaintenance,
    subTotal: amount(amount(quantityInspection.mul(priceInspection)).add(amount(quantityMaintenance.mul(priceMaintenance ?? 0)))),
    createdById: actor.id,
  };
}

async function saveRevision(tx: Prisma.TransactionClient, id: string, actor: AuditActor, action: string) {
  const quote = await tx.quotation.findUniqueOrThrow({ where: { id }, include });
  await tx.quotationHistory.create({ data: {
      quotationId: id, version: quote.version, action, snapshot: json(quote), createdById: actor.id,
  } });
  return quote;
}

async function totals(tx: Prisma.TransactionClient, id: string, tax: Prisma.Decimal) {
  const rows = await tx.quotationItem.findMany({ where: { quotationId: id, isActive: true } });
  const subTotal = amount(rows.reduce((sum, row) => sum.add(row.subTotal), new Prisma.Decimal(0)));
  const taxAmount = amount(subTotal.mul(tax).div(100));
  return { subTotal, taxAmount, total: amount(subTotal.add(taxAmount)) };
}

// All header/item writes go through this aggregate. Never update items independently.
export const quotationRepository = {
  async find(id: string, officeBranchId: string) {
    const quote = await prisma.quotation.findFirst({ where: { id, officeBranchId }, include });
    if (!quote) throw new HttpError('Quotation not found', 404);
    return quote;
  },
  findPdf: (bucket: string, key: string) => prisma.quotationPdf.findUnique({ where: { bucket_key: { bucket, key } } }),
  async list({ page, limit, isActive }: ListQuotationsInput, officeBranchId: string) {
    const where = { officeBranchId, isActive };
    const [quotations, total] = await prisma.$transaction([
      prisma.quotation.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit,
        include }),
      prisma.quotation.count({ where }),
    ]);
    return { quotations, pagination: buildPagination(page, limit, total) };
  },
  async findActive(id: string, officeBranchId: string) {
    const quote = await prisma.quotation.findFirst({ where: { id, officeBranchId, isActive: true },
      include: { pdfDocument: true, items: { where: { isActive: true }, orderBy: { position: 'asc' } } } });
    if (!quote) throw new HttpError('Quotation not found', 404);
    return quote;
  },
  async create(input: unknown, officeBranchId: string, actor: AuditActor) {
    const { items, companyId, date: _clientDate, ...data } = createQuotationSchema.parse(input);
    return prisma.$transaction(async (tx) => {
      await lockCompanyBranch(tx, officeBranchId);
      const now = new Date();
      const customerSnapshot = await customer(tx, companyId, data.staffId, officeBranchId);
      const context = await standardPriceContext(tx, (customerSnapshot.companySnapshot as { id: string }).id, officeBranchId);
      const tax = await applicableTax(tx, officeBranchId, now);
      const quote = await tx.quotation.create({ data: { ...data, date: quotationDate(now), tax: tax.percentage, taxSourceId: tax.id, status: 'CREATED', invoiceStatus: null, officeBranchId, ...customerSnapshot, createdById: actor.id, createdByName: actor.name } });
      for (const [position, item] of items.entries()) {
        await tx.quotationItem.create({ data: { ...await newItem(tx, item, officeBranchId, actor, position, context!, now), quotationId: quote.id } });
      }
      await tx.quotation.update({ where: { id: quote.id }, data: await totals(tx, quote.id, quote.tax) });
      return saveRevision(tx, quote.id, actor, 'CREATE');
    }, { maxWait: 10000, timeout: 20000 });
  },

  async approve(id: string, version: number, officeBranchId: string, actor: AuditActor,
    storePdf: (quote: Prisma.QuotationGetPayload<{ include: typeof include }>) => Promise<QuotationPdfMetadata>) {
    return prisma.$transaction(async (tx) => {
      const claimed = await tx.quotation.updateMany({
        where: { id, officeBranchId, version, isActive: true, status: { in: [...approvableStatuses] } },
        data: { status: 'APPROVED', version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name },
      });
      if (!claimed.count) throw new HttpError('Quotation has changed or cannot be approved; reload before retrying', 409);
      const current = await tx.quotation.findUniqueOrThrow({ where: { id }, include });
      if (current.pdfDocument) throw new HttpError('Quotation already has a historical PDF', 409);
      if (!current.items.some(item => item.isActive)) throw new HttpError('Quotation must contain active items before approval', 409);
      // Capture the contact title for older drafts before their first PDF is frozen.
      const companySnapshot = current.companySnapshot as Record<string, unknown>;
      if (current.staffId && !('staffTitle' in companySnapshot)) {
        const staff = await tx.companyStaff.findFirst({ where: { id: current.staffId, company: { officeBranchId } }, select: { title: true } });
        if (staff) await tx.quotation.update({ where: { id }, data: { companySnapshot: json({ ...companySnapshot, staffTitle: staff.title }) } });
      }
      // Capture scopes once for older drafts that predate service snapshots.
      const legacyItems = current.items.filter(item => {
        const snapshot = item.priceSelection as Record<string, unknown> | null;
        return item.isActive && (typeof snapshot?.inspectionScopes !== 'string' || typeof snapshot?.maintenanceScopes !== 'string');
      });
      if (legacyItems.length) {
        const sizes = await tx.itemSize.findMany({ where: { id: { in: legacyItems.map(item => item.itemSizeId) }, item: { officeBranchId } },
          include: { item: { include: { service: { include: serviceScopeInclude } } } } });
        const bySize = new Map(sizes.map(size => [size.id, size.item.service]));
        for (const item of legacyItems) {
          const service = bySize.get(item.itemSizeId);
          if (!service) throw new HttpError('Unable to resolve quotation service scopes', 409);
          await tx.quotationItem.update({ where: { id: item.id }, data: {
            priceSelection: json({ ...(item.priceSelection as Record<string, unknown> | null), ...serviceScopeSnapshot(service) }),
          } });
        }
      }
      const previous = current.previousQuotationId
        ? await tx.quotation.findUniqueOrThrow({ where: { id: current.previousQuotationId } }) : null;
      // Revisions inherit the approved number only at approval. New quotations allocate a fresh number.
      const numberYear = previous?.numberYear ?? current.numberYear ?? quotationNumberYear();
      const existingNumber = previous?.no ?? current.no;
      const no = existingNumber ?? await lockNextQuotationNumber(tx, officeBranchId, numberYear);
      // Read the date after acquiring the sequence lock so approval order determines the date.
      const date = existingNumber === null ? quotationDate() : previous?.date ?? current.date ?? quotationDate();
      const numbered = await tx.quotation.update({ where: { id }, data: { no, numberYear, date }, include });
      const document = await storePdf(numbered);
      await tx.quotationPdf.create({ data: { ...document, approvedAt: new Date(document.approvedAt), quotationId: id } });
      if (existingNumber === null) await tx.quotationSequence.update({
        where: { officeBranchId_year: { officeBranchId, year: numberYear } }, data: { lastNumber: no },
      });
      return saveRevision(tx, id, actor, 'APPROVE');
    }, { maxWait: 10000, timeout: 60000 });
  },

  async update(id: string, input: unknown, officeBranchId: string, actor: AuditActor) {
    const { version, items, companyId, date: _clientDate, ...data } = updateQuotationSchema.parse(input);
    return prisma.$transaction(async (tx) => {
      await lockCompanyBranch(tx, officeBranchId);
      const now = new Date();
      // Atomic compare-and-swap locks the row before touching any children.
      const claimed = await tx.quotation.updateMany({
        where: { id, officeBranchId, version, isActive: true },
        data: { version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name },
      });
      if (!claimed.count) {
        if (!await tx.quotation.findFirst({ where: { id, officeBranchId } })) throw new HttpError('Quotation not found', 404);
        throw new HttpError('Quotation has changed or is inactive; reload before retrying', 409);
      }
      const current = await tx.quotation.findUniqueOrThrow({ where: { id }, include });
      const headerChanged = Object.entries(data).some(([key, value]) => {
        if (value === undefined) return false;
        const previous = current[key as keyof typeof current];
        return value instanceof Date && previous instanceof Date
          ? value.getTime() !== previous.getTime() : value !== previous;
      });
      const currentCompanyId = (current.companySnapshot as { id: string }).id;
      const companyChanged = companyId !== undefined && companyId !== currentCompanyId;
      const staffChanged = data.staffId !== undefined && data.staffId !== current.staffId;
      if ((companyChanged || staffChanged) && !items) throw new HttpError('Changing customer requires the complete item list', 400);
      const selectedStaffId = data.staffId ?? current.staffId;
      const selectedCustomer = companyChanged || staffChanged
        ? await customer(tx, companyId ?? (data.staffId ? undefined : currentCompanyId), selectedStaffId!, officeBranchId) : null;
      const context = items ? await standardPriceContext(tx, ((selectedCustomer?.companySnapshot ?? current.companySnapshot) as { id: string }).id, officeBranchId) : null;
      const activeItems = current.items.filter((item) => item.isActive);
      const itemsChanged = items !== undefined && (items.length !== activeItems.length || items.some((item, position) => {
        const previous = activeItems[position];
        return !previous || item.id !== previous.id || item.itemSizeId !== previous.itemSizeId
          || !previous.quantityInspection.equals(item.quantityInspection) || !previous.quantityMaintenance.equals(item.quantityMaintenance);
      }));
      let revised = headerChanged || itemsChanged || companyChanged;
      const customerSnapshot = selectedCustomer ?? undefined;
      // Resolve all requested prices before mutating anything, including signed historical rows.
      const prepared: Array<{ id?: string; data: Awaited<ReturnType<typeof newItem>> }> = [];
      if (items) {
        for (const [position, item] of items.entries()) {
          const refreshed = await newItem(tx, item, officeBranchId, actor, position, context!, now);
          if (item.id) {
            const previous = current.items.find((row) => row.id === item.id && row.isActive);
            if (!previous) throw new HttpError('Quotation item not found', 404);
            if (previous.itemSizeId !== item.itemSizeId) throw new HttpError('Replace the item with a new line to change its catalog reference', 400);
            if (!previous.priceInspection.equals(refreshed.priceInspection) || String(previous.priceMaintenance) !== String(refreshed.priceMaintenance)
              || Object.entries(refreshed.priceSelection as Record<string, unknown>).some(([key, value]) => (previous.priceSelection as Record<string, unknown> | null)?.[key] !== value)
              || previous.serviceType !== refreshed.serviceType || previous.serviceName !== refreshed.serviceName || previous.itemName !== refreshed.itemName || previous.size !== refreshed.size) revised = true;
          }
          prepared.push({ id: item.id, data: refreshed });
        }
      }

      if (revised && (current.pdfDocument || current.status === 'APPROVED')) {
        // A PDF is the immutable source of truth for this row. Fork a new draft instead of editing it.
        const { id: _id, items: _items, pdfDocument: _pdf, createdAt: _createdAt, updatedAt: _updatedAt, ...header } = current;
        const draft = await tx.quotation.create({ data: {
          ...header, ...data, ...(companyChanged ? { staffId: selectedStaffId } : {}), ...customerSnapshot,
          companySnapshot: customerSnapshot?.companySnapshot ?? json(current.companySnapshot),
          previousQuotationId: id, no: null, numberYear: null, revision: current.revision + 1,
          status: 'REVISED', invoiceStatus: null, deliveryInvoice: data.deliveryInvoice !== undefined ? data.deliveryInvoice : current.deliveryInvoice, version: 0, isActive: true, createdById: actor.id, createdByName: actor.name, updatedById: null, updatedByName: null,
        } });
        const copiedItems = items ? prepared.map(row => row.data) : activeItems.map(row => ({
          itemSizeId: row.itemSizeId, position: row.position, serviceName: row.serviceName, serviceType: row.serviceType,
          itemName: row.itemName, size: row.size, quantityInspection: row.quantityInspection,
          quantityMaintenance: row.quantityMaintenance, priceInspection: row.priceInspection,
          priceMaintenance: row.priceMaintenance, subTotal: row.subTotal,
          priceSelection: row.priceSelection === null ? Prisma.DbNull : json(row.priceSelection), createdById: actor.id,
        }));
        for (const row of copiedItems) await tx.quotationItem.create({ data: { ...row, quotationId: draft.id } });
        await tx.quotation.update({ where: { id: draft.id }, data: await totals(tx, draft.id, draft.tax) });
        await tx.quotation.update({ where: { id }, data: { isActive: false, updatedById: actor.id, updatedByName: actor.name } });
        await saveRevision(tx, id, actor, 'SUPERSEDE');
        return saveRevision(tx, draft.id, actor, 'REVISE');
      }

      // Identical updates of a signed quotation must not touch its item snapshots.
      if (current.pdfDocument) return saveRevision(tx, id, actor, 'UPDATE');
      if (items) {
        const retained = prepared.flatMap(row => row.id ? [row.id] : []);
        await tx.quotationItem.updateMany({ where: { quotationId: id, isActive: true, id: { notIn: retained } },
          data: { isActive: false, updatedById: actor.id } });
        for (const row of prepared) {
          if (row.id) {
            const { createdById: _createdById, ...changes } = row.data;
            await tx.quotationItem.update({ where: { id: row.id }, data: { ...changes, updatedById: actor.id } });
          } else await tx.quotationItem.create({ data: { ...row.data, quotationId: id } });
        }
      }
      await tx.quotation.update({ where: { id }, data: {
        ...data, ...(companyChanged ? { staffId: selectedStaffId } : {}), ...customerSnapshot,
        ...await totals(tx, id, current.tax),
        updatedById: actor.id, updatedByName: actor.name,
      } });
      return saveRevision(tx, id, actor, 'UPDATE');
    }, { maxWait: 10000, timeout: 20000 });
  },

  async deactivate(id: string, input: unknown, officeBranchId: string, actor: AuditActor) {
    const { version } = deactivateQuotationSchema.parse(input);
    return prisma.$transaction(async (tx) => {
      const claimed = await tx.quotation.updateMany({
        where: { id, officeBranchId, version, isActive: true },
        data: { isActive: false, version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name },
      });
      if (!claimed.count) {
        if (!await tx.quotation.findFirst({ where: { id, officeBranchId } })) throw new HttpError('Quotation not found', 404);
        throw new HttpError('Quotation has changed or is inactive; reload before retrying', 409);
      }
      await tx.quotationItem.updateMany({ where: { quotationId: id, isActive: true }, data: { isActive: false, updatedById: actor.id } });
      return saveRevision(tx, id, actor, 'DEACTIVATE');
    });
  },

  history: (id: string, officeBranchId: string) => prisma.quotationHistory.findMany({
    where: { quotationId: id, quotation: { officeBranchId } }, orderBy: { version: 'asc' },
  }),
};
