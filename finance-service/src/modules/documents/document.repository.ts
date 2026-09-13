import { applicableTax } from '../taxes/tax.repository.js';
import { Document, DocumentKind, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { Actor } from '../../middlewares/actor.middleware.js';
import { QuotationSnapshot } from '../../integrations/gateway.js';
import { HttpError } from '../../utils/httpError.js';
import { createSchema, updateSchema, deleteSchema, listSchema } from './document.schemas.js';
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
  async create(kind: DocumentKind, input: z.infer<typeof createSchema>, quotation: QuotationSnapshot, actor: Actor) {
    if (quotation.id !== input.quotationId || quotation.officeBranchId !== actor.officeBranchId || quotation.version !== input.quotationVersion || !quotation.isActive) throw new HttpError('Quotation reference does not match', 409);
    checkDates(input);
    return prisma.$transaction(async tx => {
      const tax = await applicableTax(tx, actor.officeBranchId, input.date);
      const subTotal = new Prisma.Decimal(quotation.subTotal);
      const taxAmount = subTotal.mul(tax.percentage).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const row = await tx.document.create({ data: { ...input, kind, officeBranchId: actor.officeBranchId, quotationSnapshot: json(quotation), subTotal, taxSourceId: tax.id, tax: tax.percentage, taxAmount, total: subTotal.plus(taxAmount), createdById: actor.id, createdByName: actor.name } });
      return saveHistory(tx, row, null, actor, 'CREATE');
    });
  },
  async list(kind: DocumentKind, input: z.infer<typeof listSchema>, actor: Actor) {
    const {page,limit,search, ...filters} = input;
    const where: Prisma.DocumentWhereInput = { ...filters, kind, officeBranchId: actor.officeBranchId, isActive: true, ...(search ? { OR: [{number: {contains: search, mode:'insensitive'}}, {title: {contains: search, mode:'insensitive'}}] } : {}) };
    const [documents, total] = await prisma.$transaction([prisma.document.findMany({where, orderBy:[{createdAt:'desc'},{id:'desc'}], skip:(page-1)*limit,take:limit}),prisma.document.count({where})], {isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead});
    return {documents,pagination:pagination(page,limit,total)};
  },
  async get(kind: DocumentKind, id: string, actor: Actor, includeDeleted = false) {
    const row = await prisma.document.findFirst({where:{id,kind,officeBranchId:actor.officeBranchId,...(includeDeleted ? {} : {isActive:true})}});
    if (!row) throw new HttpError('Document not found',404);
    return row;
  },
  async mutate(kind: DocumentKind, id: string, input: z.infer<typeof updateSchema> | z.infer<typeof deleteSchema>, actor: Actor, deleting = false) {
    const { version, reason, ...fields } = input;
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
    const actions: Record<string,string> = {CREATE:'Document created',UPDATE:'Document updated',DEACTIVATE:'Document deleted'};
    return { history: rows.map(({createdById,createdByName,createdAt,...row}) => ({...row,actionLabel:actions[row.action] ?? row.action,changedBy:{id:createdById,name:createdByName},changedAt:createdAt})),pagination:pagination(page,limit,total) };
  },
};
