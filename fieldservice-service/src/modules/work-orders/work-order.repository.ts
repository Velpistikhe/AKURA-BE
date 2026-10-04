import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { Actor } from '../../middlewares/actor.middleware.js';
import { QuotationSnapshot, ContractSnapshot, validateContract } from '../../integrations/gateway.js';
import { HttpError } from '../../utils/httpError.js';
import { CreateWorkOrderInput, UpdateWorkOrderInput, listWorkOrderSchema } from './work-order.schemas.js';
import { nextWorkOrderIdentity } from './work-order-number.js';
const include = { inspectors: { orderBy: { position: 'asc' as const } } };
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
type WorkOrderSnapshot = Prisma.WorkOrderGetPayload<{ include: typeof include }>;
const historyLabels: Record<string, string> = {
  number: 'Work order number', date: 'Document date', quotationId: 'Quotation', quotationVersion: 'Quotation version',
  quotationSnapshot: 'Quotation snapshot', contractId: 'Contract', contractVersion: 'Contract version',
  contractSnapshot: 'Contract snapshot', startDate: 'Start date', endDate: 'End date',
  status: 'Status', revoked: 'Revoked', summary: 'Summary', inspectors: 'Inspectors',
};
const historyActions: Record<string, string> = { CREATE: 'Work order created', UPDATE: 'Work order updated', REVOKE: 'Work order deleted' };
const historyFields = Object.keys(historyLabels) as (keyof typeof historyLabels)[];
async function saveHistory(tx: Prisma.TransactionClient, row: WorkOrderSnapshot, before: WorkOrderSnapshot | null, actor: Actor, action: 'CREATE' | 'UPDATE' | 'REVOKE') {
  const afterValues = JSON.parse(JSON.stringify(row));
  const beforeValues = before ? JSON.parse(JSON.stringify(before)) : {};
  // Inspector row IDs may be replaced; report changes to names/order, not generated IDs.
  const value = (values: typeof afterValues, field: string) => field === 'inspectors'
    ? values.inspectors?.map((item: { name: string }) => item.name) ?? [] : values[field] ?? null;
  const changes = historyFields.flatMap(field => {
    const previous = value(beforeValues, field), next = value(afterValues, field);
    return JSON.stringify(previous) === JSON.stringify(next) ? [] : [{ field, label: historyLabels[field], before: previous, after: next }];
  });
  await tx.workOrderHistory.create({ data: { workOrderId: row.id, version: row.version, action,
    beforeSnapshot: before ? json(before) : Prisma.DbNull, snapshot: json(row), changes: json(changes),
    createdById: actor.id, createdByName: actor.name } });
  return row;
}
const inspectorRows = (names: string[]) => names.map((name, position) => ({ name, position }));
function reference(input: { quotationId?: string | null; quotationVersion?: number | null; companyId?: string | null; contractId?: string | null; contractVersion?: number | null }, source: QuotationSnapshot | ContractSnapshot | null, actor: Actor) {
  const cleared = { quotationId: null, quotationVersion: null, quotationSnapshot: Prisma.DbNull, contractId: null, contractVersion: null, contractSnapshot: Prisma.DbNull };
  if (Number(!!input.quotationId) + Number(!!input.contractId) + Number(!!input.companyId) !== 1) throw new HttpError('Exactly one quotation, contract or company is required', 400);
  if (input.companyId) {
    const contract = source as ContractSnapshot | null;
    if (!contract || contract.companyId !== input.companyId || contract.company?.id !== input.companyId || contract.company?.officeBranchId !== actor.officeBranchId) throw new HttpError('Contract reference does not match', 409);
    validateContract(contract);
    return { ...cleared, contractId: contract.id, contractVersion: contract.version, contractSnapshot: json(contract) };
  }
  if (input.contractId) {
    const contract = source as ContractSnapshot | null;
    if (!contract || contract.id !== input.contractId || contract.version !== input.contractVersion
      || contract.company?.id !== contract.companyId || contract.company?.officeBranchId !== actor.officeBranchId) throw new HttpError('Contract reference does not match', 409);
    validateContract(contract);
    return { ...cleared, contractId: contract.id, contractVersion: contract.version, contractSnapshot: json(contract) };
  }
  const quote = source as QuotationSnapshot | null;
  if (!quote || quote.id !== input.quotationId || quote.version !== input.quotationVersion || quote.officeBranchId !== actor.officeBranchId || !quote.isActive || quote.status !== 'APPROVED') throw new HttpError('An APPROVED quotation in this branch is required', 409);
  if (quote.items.some(item => (item.priceSelection as Record<string, unknown> | null)?.priceSource === 'CONTRACT')) throw new HttpError('Use contract as the work order basis', 409);
  return { ...cleared, quotationId: quote.id, quotationVersion: quote.version, quotationSnapshot: json(quote) };
}
function checkDates(startDate: Date, endDate?: Date | null) {
  if (endDate && endDate < startDate) throw new HttpError('End date cannot precede start date', 400);
}
export const workOrderRepository = {
  async history(id: string, page: number, limit: number, actor: Actor) {
    await this.get(id, actor);
    const where = { workOrderId: id, workOrder: { officeBranchId: actor.officeBranchId } };
    const [rows, total] = await prisma.$transaction([
      prisma.workOrderHistory.findMany({ where, orderBy: { version: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.workOrderHistory.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const history = rows.map(entry => ({
      ...entry, actionLabel: historyActions[entry.action] ?? entry.action,
      changedBy: { id: entry.createdById, name: entry.createdByName }, changedAt: entry.createdAt,
    }));
    return { history, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },
  async create(input: CreateWorkOrderInput, quote: QuotationSnapshot | ContractSnapshot | null, actor: Actor) {
    const { inspectors = [], quotationId: _quotationId, quotationVersion: _quotationVersion, companyId: _companyId, contractId: _contractId, contractVersion: _contractVersion, ...fields } = input;
    const quotation = reference(input, quote, actor);
    checkDates(input.startDate, input.endDate);
    return prisma.$transaction(async tx => {
      const identity = await nextWorkOrderIdentity(tx, actor.officeBranchId);
      const row = await tx.workOrder.create({ data: { ...fields, ...quotation, ...identity, officeBranchId: actor.officeBranchId,
        createdById: actor.id, createdByName: actor.name, inspectors: { create: inspectorRows(inspectors) } }, include });
      return saveHistory(tx, row, null, actor, 'CREATE');
    }, { maxWait: 10000, timeout: 20000 });
  },
  async list(input: z.infer<typeof listWorkOrderSchema>, actor: Actor) {
    const { page, limit, search, ...filters } = input;
    const where: Prisma.WorkOrderWhereInput = { ...filters, officeBranchId: actor.officeBranchId,
      ...(search ? { OR: [{ number: { contains: search, mode: 'insensitive' } }, { summary: { contains: search, mode: 'insensitive' } }] } : {}) };
    const [workOrders, total] = await prisma.$transaction([
      prisma.workOrder.findMany({ where, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit }),
      prisma.workOrder.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { workOrders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },
  async get(id: string, actor: Actor) {
    const workOrder = await prisma.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId }, include });
    if (!workOrder) throw new HttpError('Work order not found', 404);
    return workOrder;
  },
  async update(id: string, input: UpdateWorkOrderInput, quote: QuotationSnapshot | ContractSnapshot | null, actor: Actor) {
    const { version, inspectors, quotationId, quotationVersion, companyId, contractId, contractVersion, ...fields } = input;
    const quotation = (quotationId !== undefined || companyId !== undefined || contractId !== undefined) ? reference({ quotationId, quotationVersion, companyId, contractId, contractVersion }, quote, actor) : {};
    return prisma.$transaction(async tx => {
      const before = await tx.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId }, include });
      const claimed = await tx.workOrder.updateMany({ where: { id, officeBranchId: actor.officeBranchId, version, revoked: false },
        data: { version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });
      if (!claimed.count) {
        if (!await tx.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId } })) throw new HttpError('Work order not found', 404);
        throw new HttpError('Work order has changed or is revoked; reload before retrying', 409);
      }
      const current = await tx.workOrder.findUniqueOrThrow({ where: { id } });
      checkDates(fields.startDate ?? current.startDate, fields.endDate !== undefined ? fields.endDate : current.endDate);
      if (inspectors !== undefined) {
        await tx.workOrderInspector.deleteMany({ where: { workOrderId: id } });
        if (inspectors.length) await tx.workOrderInspector.createMany({ data: inspectorRows(inspectors).map(row => ({ ...row, workOrderId: id })) });
      }
      const row = await tx.workOrder.update({ where: { id }, data: { ...fields, ...quotation }, include });
      return saveHistory(tx, row, before, actor, 'UPDATE');
    });
  },
  async revoke(id: string, version: number, actor: Actor) {
    return prisma.$transaction(async tx => {
      const before = await tx.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId }, include });
      const claimed = await tx.workOrder.updateMany({ where: { id, officeBranchId: actor.officeBranchId, version, revoked: false },
        data: { revoked: true, version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });
      if (!claimed.count) {
        if (!await tx.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId } })) throw new HttpError('Work order not found', 404);
        throw new HttpError('Work order has changed or is revoked; reload before retrying', 409);
      }
      const row = await tx.workOrder.findUniqueOrThrow({ where: { id }, include });
      return saveHistory(tx, row, before, actor, 'REVOKE');
    });
  },
};
