import { nextProformaIdentity } from '../proforma-invoices/proforma-number.js';
import { applicableTax } from '../taxes/tax.repository.js';
import { Document, DocumentKind, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { Actor } from '../../middlewares/actor.middleware.js';
import { QuotationSnapshot } from '../../integrations/gateway.js';
import { HttpError } from '../../utils/httpError.js';
import { createProformaSchema, createInvoiceSchema, updateSchema, deleteSchema, listSchema } from './document.schemas.js';
import { nextInvoiceIdentity } from '../invoices/invoice-number.js';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const labels: Record<string,string> = { number: 'Document number', title: 'Title', date: 'Document date', dueDate: 'Due date', notes: 'Notes', content: 'Report content', status: 'Status', isActive: 'Active', quotationId: 'Quotation', quotationVersion: 'Quotation version', subTotal: 'Subtotal', tax: 'Tax percentage', taxSourceId: 'Tax source', taxAmount: 'Tax amount', total: 'Total' };
const pagination = (page: number, limit: number, total: number) => ({ page, limit, total, totalPages: Math.ceil(total / limit) });
async function saveHistory(tx: Prisma.TransactionClient, row: Document, before: Document | null, actor: Actor, action: string, reason?: string) {
  const after = json(row) as Record<string, unknown>;
  const previous = before ? json(before) as Record<string, unknown> : {};
  const changes = Object.entries(labels).filter(([field]) => field in after && JSON.stringify(after[field]) !== JSON.stringify(previous[field])).map(([field, label]) => ({ field, label, before: previous[field] ?? null, after: after[field] }));
  await tx.documentHistory.create({ data: { documentId: row.id, version: row.version, action, snapshot: json(row), changes: json(changes), reason, createdById: actor.id, createdByName: actor.name } });
  return row;
}
function checkDates(value: { date: Date; dueDate?: Date | null }) {
  if (value.dueDate && value.dueDate < value.date) throw new HttpError('Due date cannot precede document date', 400);
}
export const documentRepository = {
  async createFromMarketing(kind: DocumentKind, quotation: import('../../integrations/gateway.js').MarketingQuotation, dueDate: Date | null | undefined, notes: string | null | undefined, actor: Actor) {

    if (quotation.officeBranchId !== actor.officeBranchId || !quotation.isActive || quotation.status !== 'APPROVED') throw new HttpError('Quotation is invalid or does not belong to this branch', 409);
    const lines = quotation.items.map((item, position) => ({
      quotationItemId: item.id, position, itemSizeId: item.itemSizeId, serviceName: item.serviceName, serviceType: item.serviceType, itemName: item.itemName,
      size: item.size, note: item.note, quantityInspection: new Prisma.Decimal(item.quantityInspection), quantityMaintenance: new Prisma.Decimal(item.quantityMaintenance),
      priceInspection: new Prisma.Decimal(item.priceInspection), priceMaintenance: item.priceMaintenance === null ? null : new Prisma.Decimal(item.priceMaintenance),
      discount: new Prisma.Decimal(item.discount), subTotal: new Prisma.Decimal(item.subTotal), quotationSnapshot: json(item),
    }));
    const sum = lines.reduce((total, item) => total.plus(item.subTotal), new Prisma.Decimal(0)).toDecimalPlaces(2);
    if (sum.toString() !== new Prisma.Decimal(quotation.subTotal).toDecimalPlaces(2).toString()) throw new HttpError('Quotation item totals do not match subtotal', 409);
    return prisma.$transaction(async tx => {
      const identity = kind === 'INVOICE' ? await nextInvoiceIdentity(tx, actor.officeBranchId) : await nextProformaIdentity(tx, actor.officeBranchId);
      const date = identity.date; checkDates({ date, dueDate });
      const tax = await applicableTax(tx, actor.officeBranchId, date), subTotal = new Prisma.Decimal(quotation.subTotal);
      const taxAmount = subTotal.mul(tax.percentage).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const row = await tx.document.create({ data: {
        quotationId: quotation.id, quotationVersion: quotation.version, quotationSnapshot: json(quotation), title: quotation.subject,
        date, dueDate: dueDate ?? null, notes: notes ?? null, number: identity.number, kind, officeBranchId: actor.officeBranchId,
        subTotal, taxSourceId: tax.id, tax: tax.percentage, taxAmount, total: subTotal.plus(taxAmount), status: 'DRAFT',
        createdById: actor.id, createdByName: actor.name, items: { create: lines },
      } });
      return saveHistory(tx, row, null, actor, 'CREATE');
    }, { maxWait: 10000, timeout: 20000 });
  },
  async approve(kind: DocumentKind, id: string, version: number, actor: Actor) {
    return prisma.$transaction(async tx => {
      const before = await tx.document.findFirst({ where: { id, kind, officeBranchId: actor.officeBranchId, isActive: true } });
      if (!before) throw new HttpError('Document not found', 404);
      if (before.version !== version || before.status !== 'DRAFT') throw new HttpError('Document has changed or is not DRAFT', 409);
      const claimed = await tx.document.updateMany({ where: { id, kind, officeBranchId: actor.officeBranchId, isActive: true, version, status: 'DRAFT' }, data: { status: 'ON_PROGRESS', version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });
      if (!claimed.count) throw new HttpError('Document has changed or is not DRAFT', 409);
      const row = await tx.document.findUniqueOrThrow({ where: { id } });
      return saveHistory(tx, row, before, actor, 'APPROVE');
    });
  },
  async create(kind: DocumentKind, input: z.infer<typeof createProformaSchema> | z.infer<typeof createInvoiceSchema>, quotation: QuotationSnapshot, actor: Actor) {
    if ('number' in input || (kind === 'INVOICE' && 'date' in input)) throw new HttpError('Document number is server-generated; invoice date is also server-generated', 400);
    if (quotation.id !== input.quotationId || quotation.officeBranchId !== actor.officeBranchId || quotation.version !== input.quotationVersion || !quotation.isActive) throw new HttpError('Quotation reference does not match', 409);
    return prisma.$transaction(async tx => {
      const identity = kind === 'INVOICE' ? await nextInvoiceIdentity(tx, actor.officeBranchId) : await nextProformaIdentity(tx, actor.officeBranchId);
      const number = identity.number;
      const date = kind === 'INVOICE' ? identity.date : 'date' in input ? input.date : undefined;
      if (!number || !date) throw new HttpError('Document number and date are required', 400);
      checkDates({ date, dueDate: input.dueDate });
      const tax = await applicableTax(tx, actor.officeBranchId, date);
      const subTotal = new Prisma.Decimal(quotation.subTotal);
      const taxAmount = subTotal.mul(tax.percentage).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const row = await tx.document.create({ data: { ...input, number, date, kind, officeBranchId: actor.officeBranchId, quotationSnapshot: json(quotation), subTotal, taxSourceId: tax.id, tax: tax.percentage, taxAmount, total: subTotal.plus(taxAmount), createdById: actor.id, createdByName: actor.name } });
      return saveHistory(tx, row, null, actor, 'CREATE');
    }, { maxWait: 10000, timeout: 20000 });
  },
  async list(kind: DocumentKind, input: z.infer<typeof listSchema>, actor: Actor) {
    const {page,limit,search, ...filters} = input;
    const where: Prisma.DocumentWhereInput = { ...filters, kind, officeBranchId: actor.officeBranchId, isActive: true, ...(search ? { OR: [{number: {contains: search, mode:'insensitive'}}, {title: {contains: search, mode:'insensitive'}}] } : {}) };
    const [documents, total] = await prisma.$transaction([prisma.document.findMany({where, orderBy:[{createdAt:'desc'},{id:'desc'}], skip:(page-1)*limit,take:limit}),prisma.document.count({where})], {isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead});
    return {documents,pagination:pagination(page,limit,total)};
  },
  async get(kind: DocumentKind, id: string, actor: Actor, includeDeleted = false) {
    const row = await prisma.document.findFirst({where:{id,kind,officeBranchId:actor.officeBranchId,...(includeDeleted ? {} : {isActive:true})}, include:{items:{orderBy:{position:'asc'}}}});
    if (!row) throw new HttpError('Document not found',404);
    return row;
  },
  async mutate(kind: DocumentKind, id: string, input: z.infer<typeof updateSchema> | z.infer<typeof deleteSchema>, actor: Actor, deleting = false) {
    const { version, reason, ...fields } = input;
    if ('number' in fields || (kind === 'INVOICE' && 'date' in fields)) throw new HttpError('Document number cannot be changed; invoice date is also immutable', 400);
    return prisma.$transaction(async tx => {
      const before = await tx.document.findFirst({where:{id,kind,officeBranchId:actor.officeBranchId}});
      if (!before) throw new HttpError('Document not found',404);
      if (!before.isActive || before.version !== version) throw new HttpError('Document has changed or is inactive; reload before retrying',409);
      checkDates({...before,...fields});
      if (!deleting && before.status === 'FINAL') throw new HttpError('Final documents cannot be edited', 409);
      let taxFields = {};
      if (!deleting && ('date' in fields || ('status' in fields && fields.status === 'FINAL'))) {
        const tax = await applicableTax(tx, actor.officeBranchId, 'date' in fields && fields.date ? fields.date : before.date);
        const taxAmount = before.subTotal.mul(tax.percentage).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        taxFields = { taxSourceId: tax.id, tax: tax.percentage, taxAmount, total: before.subTotal.plus(taxAmount) };
      }
      const claimed = await tx.document.updateMany({where:{id,kind,officeBranchId:actor.officeBranchId,version,isActive:true},data:{...(deleting ? {isActive:false} : fields),...taxFields,version:{increment:1},updatedById:actor.id,updatedByName:actor.name}});
      if (!claimed.count) throw new HttpError('Document has changed; reload before retrying',409);
      const row = await tx.document.findUniqueOrThrow({where:{id}});
      return saveHistory(tx,row,before,actor,deleting ? 'DEACTIVATE' : 'UPDATE',reason);
    });
  },
  async history(kind: DocumentKind, id: string, actor: Actor, page: number, limit: number) {
    await this.get(kind,id,actor,true);
    const where = { documentId:id };
    const [rows,total] = await prisma.$transaction([prisma.documentHistory.findMany({where,orderBy:{version:'desc'},skip:(page-1)*limit,take:limit}),prisma.documentHistory.count({where})], {isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead});
    const actions: Record<string,string> = {CREATE:'Document created',UPDATE:'Document updated',APPROVE:'Document approved',DEACTIVATE:'Document deleted'};
    return { history: rows.map(({createdById,createdByName,createdAt,...row}) => ({...row,actionLabel:actions[row.action] ?? row.action,changedBy:{id:createdById,name:createdByName},changedAt:createdAt})),pagination:pagination(page,limit,total) };
  },
};
