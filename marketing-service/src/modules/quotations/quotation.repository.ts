import { applicableTax } from '../taxes/tax-sync.js';
import { lockCompanyBranch } from '../../utils/companyAudit.js';
import { standardPriceContext, resolveQuotationPrice, quotationSizeInclude, PriceContext } from '../items/quotation-price.js';
import { Prisma, ServiceType } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AuditActor } from '../../types/auth.types.js';
import { HttpError } from '../../utils/httpError.js';
import { createQuotationSchema, deactivateQuotationSchema, QuotationItemInput, ListQuotationsInput, updateQuotationSchema, addQuotationItemSchema, deleteQuotationItemSchema, UpdateQuotationInput } from './quotation.schemas.js';
import { buildPagination } from '../../utils/listQuery.js';
import { lockNextQuotationNumber, quotationDate, quotationNumberYear } from './quotation-number.js';
import type { QuotationPdfMetadata } from './quotation-approval.service.js';
import { serviceScopeInclude, serviceScopeSnapshot } from './quotation-service-groups.js';

const include = { pdfDocument: true, items: { orderBy: { position: 'asc' as const } } };
export const approvableStatuses = ['SUBMITTED'] as const;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export const canEditQuotation = (status: string, actor: AuditActor): boolean => {
  if (actor.section !== 'MARKETING') return false;
  if (status === 'CREATED' || status === 'REJECTED') return true;
  return status === 'SUBMITTED' && actor.role === 'ADMIN';
};
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
    note: input.note ?? null,
    priceSelection: json({ ...scopeSnapshot, quantityModel: 'DUAL', priceSource: resolved.priceSource, priceId: resolved.priceId,
      priceVersion: resolved.priceVersion, contractId: resolved.contractId, contractVersion: resolved.contractVersion,
      sizeVersion: resolved.sizeVersion, itemVersion: resolved.itemVersion, serviceVersion: resolved.serviceVersion }),
    quantityInspection, quantityMaintenance, priceInspection, priceMaintenance,
    subTotal: amount(amount(quantityInspection.mul(priceInspection)).add(amount(quantityMaintenance.mul(priceMaintenance ?? 0)))),
    createdById: actor.id, createdByName: actor.name,
  };
}

async function saveRevision(tx: Prisma.TransactionClient, id: string, actor: AuditActor, action: string) {
  const quote = await tx.quotation.findUniqueOrThrow({ where: { id }, include });
  await tx.quotationHistory.create({ data: {
      quotationId: id, version: quote.version, action, snapshot: json(quote), createdById: actor.id, createdByName: actor.name,
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
  async history(id: string, officeBranchId: string, input: { page: number; limit: number; action?: string; sortBy: 'version' | 'createdAt' | 'action'; sortOrder: 'asc' | 'desc' }) {
    const quotation = await prisma.quotation.findFirst({ where: { id, officeBranchId }, select: { id: true } });
    if (!quotation) throw new HttpError('Quotation not found', 404);
    const where = { quotationId: id, ...(input.action ? { action: input.action } : {}) };
    const orderBy = { [input.sortBy]: input.sortOrder } as Prisma.QuotationHistoryOrderByWithRelationInput;
    const [history, total] = await prisma.$transaction([
      prisma.quotationHistory.findMany({ where, orderBy: [orderBy, { id: input.sortOrder }], skip: (input.page - 1) * input.limit, take: input.limit }),
      prisma.quotationHistory.count({ where }),
    ], { isolationLevel: 'RepeatableRead' });
    return { quotationId: id, history: history.map(entry => ({ ...entry, createdBy: { id: entry.createdById, name: entry.createdByName } })), pagination: buildPagination(input.page, input.limit, total) };
  },
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

  async update(id: string, input: unknown, officeBranchId: string, actor: AuditActor) {
    const data = updateQuotationSchema.parse(input) as UpdateQuotationInput;
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "quotations" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.quotation.findFirst({ where: { id, officeBranchId }, include });
      if (!current) throw new HttpError('Quotation not found', 404);
      if (!current.isActive || !canEditQuotation(current.status, actor) || current.version !== data.version) {
        throw new HttpError('Quotation has changed, is inactive, or cannot be edited by this user; reload before retrying', 409);
      }
      const { version: _version, staffId, ...changes } = data;
      let customerSnapshot: { customerSnapshot?: string; companySnapshot?: Prisma.InputJsonValue } = {};
      if (staffId && staffId !== current.staffId) {
        const companyId = (current.companySnapshot as { id?: string }).id;
        if (!companyId) throw new HttpError('Quotation company snapshot is invalid', 409);
        customerSnapshot = await customer(tx, companyId, staffId, officeBranchId);
      }
      await tx.quotation.update({ where: { id }, data: {
        ...changes, ...(staffId ? { staffId } : {}), ...customerSnapshot,
        version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name,
      } });
      return saveRevision(tx, id, actor, 'UPDATE');
    }, { maxWait: 10000, timeout: 20000 });
  },

  async addItem(id: string, input: unknown, officeBranchId: string, actor: AuditActor) {
    const data = addQuotationItemSchema.parse(input);
    const itemInput: QuotationItemInput = { itemSizeId: data.itemSizeId, note: data.note, quantityInspection: data.quantityInspection, quantityMaintenance: data.quantityMaintenance };
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "quotations" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.quotation.findFirst({ where: { id, officeBranchId }, include });
      if (!current) throw new HttpError('Quotation not found', 404);
      if (!current.isActive || !canEditQuotation(current.status, actor) || current.version !== data.version) throw new HttpError('Quotation has changed, is inactive, or cannot be edited by this user; reload before retrying', 409);
      if (current.items.some(row => row.isActive && row.itemSizeId === data.itemSizeId)) throw new HttpError('Item size already exists in this quotation', 409);
      const companyId = (current.companySnapshot as { id?: string }).id;
      if (!companyId) throw new HttpError('Quotation company snapshot is invalid', 409);
      const context = await standardPriceContext(tx, companyId, officeBranchId);
      const position = current.items.reduce((max, row) => Math.max(max, row.position), -1) + 1;
      await tx.quotationItem.create({ data: { ...await newItem(tx, itemInput, officeBranchId, actor, position, context!, new Date()), quotationId: id } });
      await tx.quotation.update({ where: { id }, data: { ...await totals(tx, id, current.tax), version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });
      return saveRevision(tx, id, actor, 'ADD_ITEM');
    }, { maxWait: 10000, timeout: 20000 });
  },

  async deleteItem(id: string, itemId: string, input: unknown, officeBranchId: string, actor: AuditActor) {
    const { quotationVersion, itemVersion } = deleteQuotationItemSchema.parse(input);
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "quotations" WHERE id = ${id}::uuid FOR UPDATE`;
      const current = await tx.quotation.findFirst({ where: { id, officeBranchId }, include });
      if (!current) throw new HttpError('Quotation not found', 404);
      if (!current.isActive || !canEditQuotation(current.status, actor) || current.version !== quotationVersion) throw new HttpError('Quotation has changed, is inactive, or cannot be edited by this user; reload before retrying', 409);
      await tx.$queryRaw`SELECT id FROM "quotation_items" WHERE id = ${itemId}::uuid AND quotation_id = ${id}::uuid FOR UPDATE`;
      const item = await tx.quotationItem.findFirst({ where: { id: itemId, quotationId: id } });
      if (!item || !item.isActive || item.version !== itemVersion) throw new HttpError('Quotation item has changed or is inactive; reload before retrying', 409);
      await tx.quotationItem.update({ where: { id: itemId }, data: { isActive: false, version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });
      await tx.quotation.update({ where: { id }, data: { ...await totals(tx, id, current.tax), version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });
      return saveRevision(tx, id, actor, 'DELETE_ITEM');
    }, { maxWait: 10000, timeout: 20000 });
  },

  async submit(id: string, version: number, officeBranchId: string, actor: AuditActor) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.quotation.updateMany({ where: { id, officeBranchId, version, isActive: true, status: { in: ['CREATED', 'REJECTED'] } }, data: { status: 'SUBMITTED', version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });
      if (!updated.count) throw new HttpError('Quotation has changed or cannot be submitted from its current status; reload before retrying', 409);
      return saveRevision(tx, id, actor, 'SUBMIT');
    });
  },

  async reject(id: string, version: number, officeBranchId: string, actor: AuditActor) {
    return prisma.$transaction(async (tx) => {
      const updated = await tx.quotation.updateMany({ where: { id, officeBranchId, version, isActive: true, status: 'SUBMITTED' }, data: { status: 'REJECTED', version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });
      if (!updated.count) throw new HttpError('Quotation has changed or cannot be rejected; reload before retrying', 409);
      return saveRevision(tx, id, actor, 'REJECT');
    });
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

  async revise(id: string, version: number, officeBranchId: string, actor: AuditActor) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "quotations" WHERE id = ${id}::uuid AND office_branch_id = ${officeBranchId}::uuid FOR UPDATE`;
      const source = await tx.quotation.findFirst({ where: { id, officeBranchId }, include });
      if (!source) throw new HttpError('Quotation not found', 404);
      if (!source.isActive || source.status !== 'APPROVED' || source.version !== version) {
        throw new HttpError('Only an active APPROVED quotation with the current version can be revised', 409);
      }
      const revised = await tx.quotation.update({ where: { id }, data: {
        status: 'REVISED', isActive: false, version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name,
      }, include });
      const copy = await tx.quotation.create({ data: {
        officeBranchId: source.officeBranchId, no: source.no, numberYear: source.numberYear,
        previousQuotationId: source.id, date: source.date, jobStart: source.jobStart,
        inquiryMethod: source.inquiryMethod, inquiryDate: source.inquiryDate, subject: source.subject,
        termOfPayment: source.termOfPayment, validity: source.validity, tax: source.tax, taxSourceId: source.taxSourceId,
        supplyAkura: source.supplyAkura, supplyCustomer: source.supplyCustomer, location: source.location,
        accomplished: source.accomplished, deliveryReports: source.deliveryReports, deliveryInvoice: source.deliveryInvoice,
        staffId: source.staffId, customerSnapshot: source.customerSnapshot, companySnapshot: json(source.companySnapshot),
        status: 'CREATED', invoiceStatus: null, subTotal: source.subTotal, taxAmount: source.taxAmount, total: source.total,
        revision: source.revision + 1, isActive: true, createdById: actor.id, createdByName: actor.name,
        items: { create: source.items.filter(item => item.isActive).map(item => ({
          itemSizeId: item.itemSizeId, position: item.position, serviceName: item.serviceName, serviceType: item.serviceType,
          itemName: item.itemName, size: item.size, note: item.note, quantityInspection: item.quantityInspection,
          quantityMaintenance: item.quantityMaintenance, priceInspection: item.priceInspection, priceMaintenance: item.priceMaintenance,
           subTotal: item.subTotal, priceSelection: item.priceSelection ? json(item.priceSelection) : undefined,
           isActive: true, version: 0, createdById: actor.id, createdByName: actor.name,
        })) },
      }, include });
      await saveRevision(tx, revised.id, actor, 'REVISE');
      return saveRevision(tx, copy.id, actor, 'CREATE_REVISION');
    }, { maxWait: 10000, timeout: 20000 });
  },
  async deactivate(id: string, input: unknown, officeBranchId: string, actor: AuditActor) {
    const { version } = deactivateQuotationSchema.parse(input);
    return prisma.$transaction(async (tx) => {
      const claimed = await tx.quotation.updateMany({ where: { id, officeBranchId, version, isActive: true }, data: { isActive: false, version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });
      if (!claimed.count) {
        if (!await tx.quotation.findFirst({ where: { id, officeBranchId } })) throw new HttpError('Quotation not found', 404);
        throw new HttpError('Quotation has changed or is inactive; reload before retrying', 409);
      }
      await tx.quotationItem.updateMany({ where: { quotationId: id, isActive: true }, data: { isActive: false, updatedById: actor.id, updatedByName: actor.name } });
      const deleted = await tx.quotation.findUniqueOrThrow({ where: { id }, include });
      await saveRevision(tx, id, actor, 'DEACTIVATE');
      if (deleted.previousQuotationId) {
        const parent = await tx.quotation.findFirst({ where: { id: deleted.previousQuotationId, officeBranchId, status: 'REVISED', isActive: false } });
        if (!parent) throw new HttpError('Original quotation cannot be restored', 409);
        const restored = await tx.quotation.update({ where: { id: parent.id }, data: { status: 'APPROVED', isActive: true, version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name }, include });
        await saveRevision(tx, restored.id, actor, 'RESTORE_APPROVED');
      }
      return deleted;
    });
  },

};
