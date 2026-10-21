import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { Actor } from '../../middlewares/actor.middleware.js';
import { QuotationSnapshot, ContractSnapshot, validateContract, toQuotationSnapshot, toContractSnapshot } from '../../integrations/gateway.js';
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

const inspectorRows = (rows: { userId: string | null; name: string }[]) =>
  rows.map(({ userId, name }, position) => ({ userId, name, position }));
/**
 * Validates submitted [{ userId, name }] inspector pairs against the
 * branch-scoped FieldServiceUser read model inside the create transaction.
 * The submitted name must exactly match the snapshot display name
 * (firstName + lastName), so the stored idUser + name pair is always the
 * confirmed snapshot. Any ID outside the branch, unknown, or with a name that
 * no longer matches the snapshot fails the whole creation (400) before
 * anything is persisted.
 */
async function resolveInspectorUsers(tx: Prisma.TransactionClient, inspectors: { userId: string; name: string }[], officeBranchId: string) {
  if (inspectors.length === 0) return [];
  const ids = inspectors.map(({ userId }) => userId);
  const users = await tx.fieldServiceUser.findMany({ where: { id: { in: ids }, officeBranchId }, select: { id: true, user: true } });
  const byId = new Map(users.map(({ id, user }) => {
    const snapshot = user as { firstName?: unknown; lastName?: unknown };
    const name = typeof snapshot.firstName === 'string' && typeof snapshot.lastName === 'string' ? `${snapshot.firstName} ${snapshot.lastName}`.trim() : '';
    return [id, name] as const;
  }));
  if (byId.size !== ids.length || inspectors.some(({ userId, name }) => !byId.get(userId) || byId.get(userId) !== name.trim()))
    throw new HttpError('One or more inspectors do not match active Field Service users in this branch', 400);
  return inspectors.map(({ userId, name }) => ({ userId, name: name.trim() }));
}
/**
 * Builds the persisted basis columns from the live Marketing payload the route
 * resolved. Exactly one basis is required, it must belong to the actor branch, and
 * only a reduced snapshot is stored: a contract keeps its number, dates and company
 * identity, a quotation keeps its identity and descriptive content without any price.
 */
function reference(input: { quotationId?: string | null; contractId?: string | null }, source: QuotationSnapshot | ContractSnapshot | null, actor: Actor) {
  const cleared = { quotationId: null, quotationSnapshot: Prisma.DbNull, contractId: null, contractSnapshot: Prisma.DbNull };
  if (Number(!!input.quotationId) + Number(!!input.contractId) !== 1) throw new HttpError('Exactly one quotation or contract is required', 400);
  if (input.contractId) {
    const contract = source as ContractSnapshot | null;
    if (!contract || contract.id !== input.contractId
      || contract.company?.id !== contract.companyId || contract.company?.officeBranchId !== actor.officeBranchId) throw new HttpError('Contract reference does not match', 409);
    validateContract(contract);
    return { ...cleared, contractId: contract.id, contractSnapshot: json(toContractSnapshot(contract)) };
  }
  const quote = source as QuotationSnapshot | null;
  if (!quote || quote.id !== input.quotationId || quote.officeBranchId !== actor.officeBranchId || !quote.isActive || quote.status !== 'APPROVED') throw new HttpError('An APPROVED quotation in this branch is required', 409);
  if (quote.items.some(item => (item.priceSelection as Record<string, unknown> | null)?.priceSource === 'CONTRACT')) throw new HttpError('Use contract as the work order basis', 409);
  return { ...cleared, quotationId: quote.id, quotationSnapshot: json(toQuotationSnapshot(quote)) };
}
function checkDates(startDate: Date, endDate?: Date | null) {
  if (endDate && endDate < startDate) throw new HttpError('End date cannot precede start date', 400);
}
/**
 * A quotation may back only one live Work order per branch: while a non-revoked
 * Work order already references the quotation, no other may be created (create)
 * or re-pointed to it (update) in the same branch. Only revoking the existing
 * Work order frees the quotation again.
 *
 * The advisory transaction lock is scoped per branch + quotation and taken before
 * the duplicate read, so concurrent creations for the same quotation serialize
 * instead of both passing a check-then-insert race (the same per-key advisory
 * lock pattern used by the quotation snapshot and user sync receivers).
 */
async function assertQuotationNotInUse(tx: Prisma.TransactionClient, officeBranchId: string, quotationId: string, excludeId?: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'work-order-quotation:' + officeBranchId + ':' + quotationId}))`;
  const existing = await tx.workOrder.findFirst({
    where: { officeBranchId, quotationId, revoked: false, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { number: true },
  });
  if (existing) throw new HttpError(`Quotation already has an active work order (${existing.number}); revoke it before creating another`, 409);
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
    const { inspectors = [], quotationId: _quotationId, contractId: _contractId, ...fields } = input;
    const quotation = reference(input, quote, actor);
    checkDates(input.startDate, input.endDate);
    // The Work Order is always created as DRAFT; the request never carries status.
    return prisma.$transaction(async tx => {
      // Serialize same-quotation requests before the duplicate read and numbering.
      // Different quotations and contract-based creations remain independent.
      if (quotation.quotationId) await assertQuotationNotInUse(tx, actor.officeBranchId, quotation.quotationId);
      const inspectorUsers = await resolveInspectorUsers(tx, inspectors, actor.officeBranchId);
      const identity = await nextWorkOrderIdentity(tx, actor.officeBranchId);
      const row = await tx.workOrder.create({ data: { ...fields, ...quotation, ...identity, officeBranchId: actor.officeBranchId, status: 'DRAFT',
        createdById: actor.id, createdByName: actor.name, inspectors: { create: inspectorRows(inspectorUsers) } }, include });
      return saveHistory(tx, row, null, actor, 'CREATE');
    }, { maxWait: 10000, timeout: 20000 });
  },
  async list(input: z.infer<typeof listWorkOrderSchema>, actor: Actor) {
    const { page, limit, search, ...filters } = input;
    const where: Prisma.WorkOrderWhereInput = { ...filters, officeBranchId: actor.officeBranchId,
      ...(search ? { OR: [{ number: { contains: search, mode: 'insensitive' } }] } : {}) };
    const [rows, total] = await prisma.$transaction([
      prisma.workOrder.findMany({
        where,
        select: {
          id: true, officeBranchId: true, number: true, date: true, contractId: true, contractSnapshot: true,
          quotationId: true, startDate: true, endDate: true, status: true, revoked: true, version: true,
          createdById: true, createdByName: true, updatedById: true, updatedByName: true,
          createdAt: true, updatedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit,
      }),
      prisma.workOrder.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const workOrders = rows.map(row => ({
      ...row,
      date: row.date.toISOString().slice(0, 10),
      startDate: row.startDate.toISOString().slice(0, 10),
      endDate: row.endDate?.toISOString().slice(0, 10) ?? null,
    }));
    return { workOrders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },
  async findActiveByQuotation(quotationId: string, actor: Actor) {
    return prisma.workOrder.findFirst({ where: { quotationId, officeBranchId: actor.officeBranchId, revoked: false },
      select: { id: true, quotationId: true, officeBranchId: true, revoked: true, number: true, status: true, version: true } });
  },
  async get(id: string, actor: Actor) {
    const workOrder = await prisma.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId }, include });
    if (!workOrder) throw new HttpError('Work order not found', 404);
    return workOrder;
  },
  async update(id: string, input: UpdateWorkOrderInput, quote: QuotationSnapshot | ContractSnapshot | null, actor: Actor) {
    const { version, inspectors, quotationId, contractId, ...fields } = input;
    const quotation = (quotationId !== undefined || contractId !== undefined) ? reference({ quotationId, contractId }, quote, actor) : {};
    return prisma.$transaction(async tx => {
      const before = await tx.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId }, include });
      const claimed = await tx.workOrder.updateMany({ where: { id, officeBranchId: actor.officeBranchId, version, revoked: false },
        data: { version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });
      if (!claimed.count) {
        if (!await tx.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId } })) throw new HttpError('Work order not found', 404);
        throw new HttpError('Work order has changed or is revoked; reload before retrying', 409);
      }
      const current = await tx.workOrder.findUniqueOrThrow({ where: { id } });
      // Re-pointing the basis at a quotation already used by another live Work
      // order in this branch is rejected under the same advisory lock.
      if ('quotationId' in quotation && typeof quotation.quotationId === 'string' && quotation.quotationId) {
        await assertQuotationNotInUse(tx, actor.officeBranchId, quotation.quotationId, id);
      }
      checkDates(fields.startDate ?? current.startDate, fields.endDate !== undefined ? fields.endDate : current.endDate);
      if (inspectors !== undefined) {
        await tx.workOrderInspector.deleteMany({ where: { workOrderId: id } });
        // PATCH keeps the name-based contract; rows edited this way have no
        // resolved Auth user ID (userId stays null).
        if (inspectors.length) {
          const rows = inspectorRows(inspectors.map(name => ({ userId: null, name })));
          await tx.workOrderInspector.createMany({ data: rows.map(row => ({ ...row, workOrderId: id })) });
        }
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
      // equality is authoritative because every Marketing content mutation bumps the
      // quotation version; the remaining fields protect against snapshot drift.
      // Monetary totals are deliberately absent: the snapshot holds no prices.
      if (!snapshot || !snapshotsMatch(
        { id: quote.id, officeBranchId: quote.officeBranchId, version: quote.version,
          status: quote.status, isActive: quote.isActive, subject: quote.subject },
        { id: stored.quotationId, officeBranchId: stored.officeBranchId, version: snapshot.version,
          status: snapshot.status, isActive: snapshot.isActive, subject: snapshot.subject },
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
  async revoke(id: string, version: number, actor: Actor, beforeCommit?: (workOrder: WorkOrderSnapshot) => Promise<void>) {
    return prisma.$transaction(async tx => {
      const before = await tx.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId }, include });
      const claimed = await tx.workOrder.updateMany({ where: { id, officeBranchId: actor.officeBranchId, version, revoked: false },
        data: { revoked: true, version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });
      if (!claimed.count) {
        if (!await tx.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId } })) throw new HttpError('Work order not found', 404);
        throw new HttpError('Work order has changed or is revoked; reload before retrying', 409);
      }
      const row = await tx.workOrder.findUniqueOrThrow({ where: { id }, include });
      // The history row is written before the Marketing callback so the only
      // remaining step after Marketing acknowledges is the commit itself.
      const history = await saveHistory(tx, row, before, actor, 'REVOKE');
      // Marketing is told before the commit. A failed callback aborts the
      // transaction, so the Work Order stays live and both services agree.
      if (beforeCommit && row.quotationId) await beforeCommit(row);
      return history;
    });
  },
};
