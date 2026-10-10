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
  number: 'Work order number', date: 'Document date', quotationId: 'Quotation',
  quotationSnapshot: 'Quotation snapshot', contractId: 'Contract',
  contractSnapshot: 'Contract snapshot', startDate: 'Start date', endDate: 'End date',
  status: 'Status', revoked: 'Revoked', inspectors: 'Inspectors',
};
const historyActions: Record<string, string> = { CREATE: 'Work order created', UPDATE: 'Work order updated', START: 'Work order started', REVOKE: 'Work order deleted' };
const historyFields = Object.keys(historyLabels) as (keyof typeof historyLabels)[];
async function saveHistory(tx: Prisma.TransactionClient, row: WorkOrderSnapshot, before: WorkOrderSnapshot | null, actor: Actor, action: 'CREATE' | 'UPDATE' | 'START' | 'REVOKE') {
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
const normalizeSnapshot = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeSnapshot);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalizeSnapshot(item)]));
  }
  return value;
};
const snapshotsMatch = (left: unknown, right: unknown): boolean =>
  JSON.stringify(normalizeSnapshot(left)) === JSON.stringify(normalizeSnapshot(right));

const inspectorRows = (names: string[]) => names.map((name, position) => ({ name, position }));
function reference(input: { quotationId?: string | null; companyId?: string | null; contractId?: string | null }, source: QuotationSnapshot | ContractSnapshot | null, actor: Actor) {
  const cleared = { quotationId: null, quotationSnapshot: Prisma.DbNull, contractId: null, contractSnapshot: Prisma.DbNull };
  if (Number(!!input.quotationId) + Number(!!input.contractId) + Number(!!input.companyId) !== 1) throw new HttpError('Exactly one quotation, contract or company is required', 400);
  if (input.companyId) {
    const contract = source as ContractSnapshot | null;
    if (!contract || contract.companyId !== input.companyId || contract.company?.id !== input.companyId || contract.company?.officeBranchId !== actor.officeBranchId) throw new HttpError('Contract reference does not match', 409);
    validateContract(contract);
    return { ...cleared, contractId: contract.id, contractSnapshot: json(contract) };
  }
  if (input.contractId) {
    const contract = source as ContractSnapshot | null;
    if (!contract || contract.id !== input.contractId
      || contract.company?.id !== contract.companyId || contract.company?.officeBranchId !== actor.officeBranchId) throw new HttpError('Contract reference does not match', 409);
    validateContract(contract);
    return { ...cleared, contractId: contract.id, contractSnapshot: json(contract) };
  }
  const quote = source as QuotationSnapshot | null;
  if (!quote || quote.id !== input.quotationId || quote.officeBranchId !== actor.officeBranchId || !quote.isActive || quote.status !== 'APPROVED') throw new HttpError('An APPROVED quotation in this branch is required', 409);
  if (quote.items.some(item => (item.priceSelection as Record<string, unknown> | null)?.priceSource === 'CONTRACT')) throw new HttpError('Use contract as the work order basis', 409);
  return { ...cleared, quotationId: quote.id, quotationSnapshot: json(quote) };
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
    const { inspectors = [], quotationId: _quotationId, companyId: _companyId, contractId: _contractId, ...fields } = input;
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
      ...(search ? { OR: [{ number: { contains: search, mode: 'insensitive' } }] } : {}) };
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
    const { version, inspectors, quotationId, companyId, contractId, ...fields } = input;
    const quotation = (quotationId !== undefined || companyId !== undefined || contractId !== undefined) ? reference({ quotationId, companyId, contractId }, quote, actor) : {};
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
  /**
   * DRAFT -> IN_PROGRESS. For quotation-based orders the stored snapshot is
   * compared against the live Marketing quotation (validated by the route before
   * the transaction starts), so an upstream call never holds database locks.
   * Contract/company-based orders transition without quotation validation.
   * The claim itself is an optimistic updateMany on status/version/revoked, so
   * concurrent starters cannot both succeed.
   */
  async start(id: string, version: number, quote: QuotationSnapshot | null, actor: Actor) {
    const stored = await prisma.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId }, include });
    if (!stored) throw new HttpError('Work order not found', 404);
    if (stored.quotationId) {
      if (!quote) throw new HttpError('Quotation validation with Marketing service is required before starting', 409);
      const snapshot = stored.quotationSnapshot as Record<string, unknown> | null;
      // Validity gate: Marketing is the source of truth. The stored snapshot must
      // still describe the same APPROVED, active quotation in this branch. Version
      // equality is authoritative because every Marketing content mutation bumps
      // the quotation version; the remaining fields protect against snapshot drift.
      if (!snapshot || !snapshotsMatch(
        { id: quote.id, officeBranchId: quote.officeBranchId, version: quote.version,
          status: quote.status, isActive: quote.isActive, subject: quote.subject,
          subTotal: quote.subTotal, taxAmount: quote.taxAmount, total: quote.total },
        { id: stored.quotationId, officeBranchId: stored.officeBranchId, version: snapshot.version,
          status: snapshot.status, isActive: snapshot.isActive, subject: snapshot.subject,
          subTotal: snapshot.subTotal, taxAmount: snapshot.taxAmount, total: snapshot.total },
      )) {
        throw new HttpError('Work order quotation snapshot does not match Marketing data; reload the quotation', 409);
      }
    }
    return prisma.$transaction(async tx => {
      const before = await tx.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId }, include });
      const claimed = await tx.workOrder.updateMany({
        where: { id, officeBranchId: actor.officeBranchId, version, status: 'DRAFT', revoked: false },
        data: { status: 'IN_PROGRESS', version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name },
      });
      if (!claimed.count) {
        if (!before) throw new HttpError('Work order not found', 404);
        throw new HttpError('Work order has changed or is not a draft; reload before retrying', 409);
      }
      const row = await tx.workOrder.findUniqueOrThrow({ where: { id }, include });
      return saveHistory(tx, row, before, actor, 'START');
    }, { maxWait: 10000, timeout: 20000 });
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
