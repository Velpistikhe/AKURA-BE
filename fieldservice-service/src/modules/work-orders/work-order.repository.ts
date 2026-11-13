import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { Actor } from '../../middlewares/actor.middleware.js';
import { QuotationSnapshot, ContractSnapshot, ItemSizeReference, CompanySnapshot, validateContract, toQuotationSnapshot, toContractSnapshot, toWorkOrderItemSnapshot } from '../../integrations/gateway.js';
import { recordAudit } from '../../utils/audit.js';
import { HttpError } from '../../utils/httpError.js';
import { CreateWorkOrderByCompanyInput, CreateWorkOrderByQuotationInput, CreateWorkOrderInput, UpdateWorkOrderInput, listWorkOrderSchema } from './work-order.schemas.js';
import { nextWorkOrderIdentity } from './work-order-number.js';
const include = { inspectors: { orderBy: { position: 'asc' as const } }, items: true };
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
type WorkOrderSnapshot = Prisma.WorkOrderGetPayload<{ include: typeof include }>;
const historyLabels: Record<string, string> = {
  number: 'Work order number', date: 'Document date', quotationId: 'Quotation',
  quotationSnapshot: 'Quotation snapshot', contractId: 'Contract',
  contractSnapshot: 'Contract snapshot', items: 'Items', startDate: 'Start date', endDate: 'End date',
  companyId: 'Company', subject: 'Subject', officialReport: 'Official report',
  dailyReport: 'Daily report', officialReportDelivery: 'Official report delivery',
  dailyReportDelivery: 'Daily report delivery', poNumber: 'PO number', poDate: 'PO date',
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
  // The generic audit entry records the same change in the platform-wide
  // audit trail, so every module can be queried through one interface.
  await recordAudit(tx, {
    module: 'work-orders',
    entityType: 'WORK_ORDER',
    entityId: row.id,
    version: row.version,
    action,
    before,
    after: row,
    officeBranchId: row.officeBranchId ?? null,
    actor,
  });
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

// Linking/unlinking a Work Order in Marketing changes the quotation's version
// and updatedAt without changing its content. Compare the price-free snapshot
// itself so those bookkeeping writes cannot invalidate a newly created order.
const quotationContent = (snapshot: Record<string, unknown>) => {
  const { version: _version, updatedAt: _updatedAt, ...content } = snapshot;
  return content;
};

const inspectorRows = (names: string[]) =>
  names.map((name, position) => ({ name, position }));
/**
 * Builds the persisted basis columns from the live Marketing payload the route
 * resolved. Exactly one basis is required, it must belong to the actor branch, and
 * only a reduced snapshot is stored: a contract keeps its number, dates and company
 * identity, a quotation keeps its identity and descriptive content without any price.
 */
function reference(input: { quotationId?: string | null; contractId?: string | null }, source: QuotationSnapshot | ContractSnapshot | null, actor: Actor) {
  const cleared = { quotationId: null, quotationSnapshot: Prisma.DbNull, contractId: null, contractSnapshot: Prisma.DbNull };
  if (Number(!!input.quotationId) + Number(!!input.contractId) < 1) throw new HttpError('At least one quotationId or contractId is required', 400);
  if (input.quotationId) {
    const quote = source as QuotationSnapshot | null;
    if (!quote || quote.id !== input.quotationId || quote.officeBranchId !== actor.officeBranchId || !quote.isActive || quote.status !== 'APPROVED') throw new HttpError('An APPROVED quotation in this branch is required', 409);
    return { ...cleared, quotationId: quote.id, quotationSnapshot: json(toQuotationSnapshot(quote)) };
  }
  return contractBasis(input.contractId, source, actor);
}

/**
 * Contract basis of the company-based creation. The contract is optional there:
 * a Work Order can be created for a company without any contract, so a missing
 * contractId simply clears the contract columns instead of failing.
 */
function contractBasis(contractId: string | null | undefined, source: QuotationSnapshot | ContractSnapshot | null, actor: Actor) {
  const cleared = { quotationId: null, quotationSnapshot: Prisma.DbNull, contractId: null, contractSnapshot: Prisma.DbNull };
  if (!contractId) return cleared;
  const contract = source as ContractSnapshot | null;
  if (!contract || contract.id !== contractId
    || contract.company?.id !== contract.companyId || contract.company?.officeBranchId !== actor.officeBranchId) throw new HttpError('Contract reference does not match', 409);
  validateContract(contract);
  return { ...cleared, contractId: contract.id, contractSnapshot: json(toContractSnapshot(contract)) };
}
function checkDates(startDate: Date, endDate?: Date | null) {
  if (endDate && endDate < startDate) throw new HttpError('End date cannot precede start date', 400);
}

type CreateHeaderPersist = {
  companyId: string;
  subject: string;
  officialReport: boolean;
  dailyReport: Date;
  officialReportDelivery: Date;
  dailyReportDelivery: Date;
  poNumber: string;
  poDate: Date;
};

/**
 * Persists the work-order header fields.
 *
 * Company basis (POST /work-orders): every header field comes from the payload.
 * The company itself was validated live against Marketing before this call, so
 * the stored companyId always points at an existing, non-revoked company.
 *
 * Quotation basis (POST /work-orders/from-quotation): the header may be omitted
 * and the server fills the defaults from the live Marketing quotation. The
 * companyId is taken from the quotation company snapshot only; the client can
 * never supply a different company for a quotation-based Work Order.
 */
function resolveCreateHeaderByCompany(input: CreateWorkOrderByCompanyInput): CreateHeaderPersist {
  return {
    companyId: input.companyId,
    subject: input.subject,
    officialReport: input.officialReport,
    dailyReport: input.dailyReport,
    officialReportDelivery: input.officialReportDelivery,
    dailyReportDelivery: input.dailyReportDelivery,
    poNumber: input.poNumber,
    poDate: input.poDate,
  };
}

function resolveCreateHeaderByQuotation(
  input: CreateWorkOrderByQuotationInput,
  quotation: QuotationSnapshot,
): CreateHeaderPersist {
  const companySnapshot = quotation.companySnapshot as Record<string, unknown>;
  const companyId = typeof companySnapshot?.id === 'string' ? companySnapshot.id : null;
  if (!companyId) throw new HttpError('The quotation carries no company snapshot; companyId could not be resolved', 409);
  const schedule = input.startDate;
  return {
    companyId,
    subject: input.subject ?? quotation.subject,
    officialReport: input.officialReport ?? false,
    dailyReport: input.dailyReport ?? schedule,
    officialReportDelivery: input.officialReportDelivery ?? schedule,
    dailyReportDelivery: input.dailyReportDelivery ?? schedule,
    poNumber: input.poNumber ?? 'Pending',
    poDate: input.poDate ?? schedule,
  };
}
/**
 * Builds the stored item rows from the submitted { itemSizeId, quantityInspection,
 * quantityMaintenance } lines. The descriptive part of the snapshot is never
 * client-supplied: a quotation basis takes it from the live Marketing quotation
 * line, so the stored snapshot matches the approved document. Another basis reads
 * it from the Marketing item-size reference resolved by the route.
 *
 * Every submitted size must exist in that source; a size that is not part of it
 * is rejected instead of stored without a description.
 */
function resolveItemSnapshots(items: CreateWorkOrderInput['items'], input: { quotationId?: string | null },
  quote: QuotationSnapshot | ContractSnapshot | null,
  itemReferences?: Array<CreateWorkOrderInput['items'][number] & { snapshot: ItemSizeReference }>) {
  if (input.quotationId) {
    const lines = new Map<string, QuotationSnapshot['items'][number]>();
    for (const line of (quote as QuotationSnapshot | null)?.items ?? []) lines.set(line.itemSizeId, line);
    return items.map(item => {
      const line = lines.get(item.itemSizeId);
      if (!line) throw new HttpError('Every item must be part of the quotation', 409);
      return { itemSizeId: item.itemSizeId, item: toWorkOrderItemSnapshot(line),
        quantityInspection: item.quantityInspection, quantityMaintenance: item.quantityMaintenance };
    });
  }
  const references = new Map((itemReferences ?? []).map(row => [row.itemSizeId, row.snapshot]));
  return items.map(item => {
    const reference = references.get(item.itemSizeId);
    if (!reference) throw new HttpError('Item size reference was not resolved', 502);
    const { itemSizeId, ...description } = reference;
    return { itemSizeId: item.itemSizeId, item: { itemSizeId, ...description },
      quantityInspection: item.quantityInspection, quantityMaintenance: item.quantityMaintenance };
  });
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
 * lock pattern used by the quotation snapshot and tax cache receiver).
 */
async function assertQuotationNotInUse(tx: Prisma.TransactionClient, officeBranchId: string, quotationId: string, excludeId?: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'work-order-quotation:' + officeBranchId + ':' + quotationId}))`;
  const existing = await tx.workOrder.findFirst({
    where: { officeBranchId, quotationId, revoked: false, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { number: true },
  });
  if (existing) throw new HttpError(`Quotation already has an active work order (${existing.number}); revoke it before creating another`, 409);
}
/**
 * Advisory lock keys for the inspector schedule. Inspectors are identified by
 * their case-insensitive display name, so two requests that book the same
 * person serialize against each other instead of double-booking them. The keys
 * are acquired in a stable sorted order, so two requests that share inspectors
 * in a different order cannot deadlock.
 */
const inspectorLockKeys = (officeBranchId: string, inspectors: string[]): string[] => {
  const keys = new Set<string>();
  for (const name of inspectors) {
    if (name) keys.add(`work-order-inspector-name:${officeBranchId}:${name.toLowerCase()}`);
  }
  return [...keys].sort();
};
/** Inclusive date ranges; a missing end date leaves the schedule open-ended. */
async function assertInspectorsAvailable(tx: Prisma.TransactionClient, officeBranchId: string,
  inspectors: string[], startDate: Date, endDate?: Date | null, excludeId?: string) {
  if (!inspectors.length) return;
  for (const key of inspectorLockKeys(officeBranchId, inspectors)) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }
  const names = [...new Set(inspectors.filter(Boolean))];
  if (!names.length) return;
  const existing = await tx.workOrder.findFirst({
    where: {
      officeBranchId, revoked: false,
      ...(excludeId ? { id: { not: excludeId } } : {}),
      ...(endDate ? { startDate: { lte: endDate } } : {}),
      OR: [{ endDate: null }, { endDate: { gte: startDate } }],
      inspectors: { some: { OR: names.map(name => ({ name: { equals: name, mode: 'insensitive' as const } })) } },
    },
    select: { number: true },
  });
  if (existing) throw new HttpError(`One or more inspectors have an overlapping work order (${existing.number})`, 409);
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
  /**
   * Company basis (POST /work-orders). The company was validated live against
   * Marketing before this call, so the stored companyId is an existing,
   * non-revoked company of the branch. A contract may still be attached; it is
   * validated against Marketing as well.
   */
  async createByCompany(input: CreateWorkOrderByCompanyInput, company: CompanySnapshot,
    actor: Actor, contract: ContractSnapshot | null,
    itemReferences?: Array<CreateWorkOrderByCompanyInput['items'][number] & { snapshot: ItemSizeReference }>) {
    // The company must belong to the same branch as the actor.
    if (company.id !== input.companyId || company.officeBranchId !== actor.officeBranchId) {
      throw new HttpError('Company not found', 404);
    }
    const {
      inspectors = [], items,
      contractId: _contractId,
      companyId: _companyId, subject: _subject, officialReport: _officialReport,
      dailyReport: _dailyReport, officialReportDelivery: _officialReportDelivery,
      dailyReportDelivery: _dailyReportDelivery, poNumber: _poNumber, poDate: _poDate,
      ...fields
    } = input;
    const header = resolveCreateHeaderByCompany(input);
    // The contract is optional on the company basis: a Work Order can be created
    // for a company without any contract, so the contract columns stay empty.
    const basis = contractBasis(input.contractId, contract, actor);
    checkDates(input.startDate, input.endDate);
    // The item description is never client-supplied: it is read from the
    // Marketing item-size reference resolved by the route.
    const itemRows = resolveItemSnapshots(items, { quotationId: null }, null, itemReferences);
    // The Work Order is always created as DRAFT; the request never carries status.
    return prisma.$transaction(async tx => {
      await assertInspectorsAvailable(tx, actor.officeBranchId, inspectors, input.startDate, input.endDate);
      const identity = await nextWorkOrderIdentity(tx, actor.officeBranchId);
      const row = await tx.workOrder.create({ data: { ...fields, ...header, ...basis, ...identity, officeBranchId: actor.officeBranchId, status: 'DRAFT',
        createdById: actor.id, createdByName: actor.name, inspectors: { create: inspectorRows(inspectors) },
        items: { create: itemRows.map(item => ({ itemSizeId: item.itemSizeId, item: json(item.item),
          quantityInspection: item.quantityInspection, quantityMaintenance: item.quantityMaintenance })) } }, include });
      return saveHistory(tx, row, null, actor, 'CREATE');
    }, { maxWait: 10000, timeout: 20000 });
  },
  /**
   * Quotation basis (POST /work-orders/from-quotation). The quotation was
   * validated live against Marketing before this call, so the stored quotation
   * snapshot matches the approved document and the companyId is the company of
   * that quotation.
   *
   * Marketing is notified of the new link before the transaction commits, so
   * the quotation records the Work Order reference together with the Work
   * Order itself. A failed notification aborts the transaction and no Work
   * Order is created, which keeps both services consistent.
   */
  async createByQuotation(input: CreateWorkOrderByQuotationInput, quotation: QuotationSnapshot, actor: Actor,
    beforeCommit?: (workOrder: WorkOrderSnapshot) => Promise<void>) {
    const {
      inspectors = [], items,
      quotationId: _quotationId,
      subject: _subject, officialReport: _officialReport,
      dailyReport: _dailyReport, officialReportDelivery: _officialReportDelivery,
      dailyReportDelivery: _dailyReportDelivery, poNumber: _poNumber, poDate: _poDate,
      ...fields
    } = input;
    const header = resolveCreateHeaderByQuotation(input, quotation);
    const basis = reference({ quotationId: input.quotationId }, quotation, actor);
    checkDates(input.startDate, input.endDate);
    // The item description is never client-supplied: a quotation basis resolves
    // it from the live Marketing quotation line.
    const itemRows = resolveItemSnapshots(items, { quotationId: input.quotationId }, quotation);
    // The Work Order is always created as DRAFT; the request never carries status.
    return prisma.$transaction(async tx => {
      // Serialize same-quotation requests before the duplicate read and numbering.
      await assertQuotationNotInUse(tx, actor.officeBranchId, basis.quotationId!);
      await assertInspectorsAvailable(tx, actor.officeBranchId, inspectors, input.startDate, input.endDate);
      const identity = await nextWorkOrderIdentity(tx, actor.officeBranchId);
      const row = await tx.workOrder.create({ data: { ...fields, ...header, ...basis, ...identity, officeBranchId: actor.officeBranchId, status: 'DRAFT',
        createdById: actor.id, createdByName: actor.name, inspectors: { create: inspectorRows(inspectors) },
        items: { create: itemRows.map(item => ({ itemSizeId: item.itemSizeId, item: json(item.item),
          quantityInspection: item.quantityInspection, quantityMaintenance: item.quantityMaintenance })) } }, include });
      const history = await saveHistory(tx, row, null, actor, 'CREATE');
      // Marketing is told before the commit. A failed callback aborts the
      // transaction, so the Work Order and the quotation link cannot disagree.
      if (beforeCommit) await beforeCommit(row);
      return history;
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
          id: true, officeBranchId: true, number: true, date: true, contractId: true,
          quotationSnapshot: true, contractSnapshot: true,
          quotationId: true, startDate: true, endDate: true,
          companyId: true, subject: true, officialReport: true,
          dailyReport: true, officialReportDelivery: true, dailyReportDelivery: true,
          poNumber: true, poDate: true,
          status: true, revoked: true, version: true,
          createdById: true, createdByName: true, updatedById: true, updatedByName: true,
          createdAt: true, updatedAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * limit, take: limit,
      }),
      prisma.workOrder.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    const workOrders = rows.map(({ quotationSnapshot, contractSnapshot, ...row }) => {
      const quotation = row.quotationId && quotationSnapshot && typeof quotationSnapshot === 'object' && !Array.isArray(quotationSnapshot) ? quotationSnapshot : null;
      const contract = row.contractId && contractSnapshot && typeof contractSnapshot === 'object' && !Array.isArray(contractSnapshot) ? contractSnapshot : null;
      return {
        ...row,
        quotationNo: typeof quotation?.no === 'number' ? quotation.no : null,
        quotationDate: typeof quotation?.date === 'string' && quotation.date ? quotation.date.slice(0, 10) : null,
        contractNumber: typeof contract?.contractNumber === 'string' ? contract.contractNumber : null,
        contractDate: typeof contract?.contractDate === 'string' && contract.contractDate ? contract.contractDate.slice(0, 10) : null,
        companyId: row.companyId,
        company: typeof contract?.companyName === 'string' ? contract.companyName
          : (quotation && typeof quotation.companySnapshot === 'object' && quotation.companySnapshot && !Array.isArray(quotation.companySnapshot)
            && typeof (quotation.companySnapshot as Record<string, unknown>).name === 'string'
            ? String((quotation.companySnapshot as Record<string, unknown>).name) : null),
        subject: row.subject,
        officialReport: row.officialReport,
        dailyReport: row.dailyReport.toISOString().slice(0, 10),
        officialReportDelivery: row.officialReportDelivery.toISOString().slice(0, 10),
        dailyReportDelivery: row.dailyReportDelivery.toISOString().slice(0, 10),
        poNumber: row.poNumber,
        poDate: row.poDate.toISOString().slice(0, 10),
        date: row.date.toISOString().slice(0, 10),
        startDate: row.startDate.toISOString().slice(0, 10),
        endDate: row.endDate?.toISOString().slice(0, 10) ?? null,
      };
    });
    return { workOrders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  },
  async get(id: string, actor: Actor) {
    const workOrder = await prisma.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId }, include });
    if (!workOrder) throw new HttpError('Work order not found', 404);
    return workOrder;
  },
  async update(id: string, input: UpdateWorkOrderInput, quote: QuotationSnapshot | ContractSnapshot | null, actor: Actor,
    beforeCommit?: (workOrder: WorkOrderSnapshot) => Promise<void>) {
    const { version, inspectors, quotationId, contractId, ...fields } = input;
    const quotation = (quotationId !== undefined || contractId !== undefined)
      ? reference({ quotationId, contractId }, quote, actor) : {};
    return prisma.$transaction(async tx => {
      const before = await tx.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId }, include });
      if (!before) throw new HttpError('Work order not found', 404);
      // The effective date pair is resolved against the stored row, so a PATCH
      // that submits only one of the two dates is still validated. The check
      // runs before the version claim, so an invalid period never writes.
      checkDates(fields.startDate ?? before.startDate, fields.endDate !== undefined ? fields.endDate : before.endDate);
      const claimed = await tx.workOrder.updateMany({ where: { id, officeBranchId: actor.officeBranchId, version, revoked: false },
        data: { version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });
      if (!claimed.count) {
        throw new HttpError('Work order has changed or is revoked; reload before retrying', 409);
      }
      const current = await tx.workOrder.findUniqueOrThrow({ where: { id } });
      // Re-pointing the basis at a quotation already used by another live Work
      // order in this branch is rejected under the same advisory lock.
      if ('quotationId' in quotation && typeof quotation.quotationId === 'string' && quotation.quotationId) {
        await assertQuotationNotInUse(tx, actor.officeBranchId, quotation.quotationId, id);
      }
      // The schedule guard runs before the inspector rows are replaced, so an
      // overlapping PATCH is rejected with 409 and the previous state survives.
      // It applies whenever the schedule can change: a new inspector list or a
      // moved period. The Work Order itself is excluded so re-saving the same
      // inspector list never conflicts with the row being edited.
      const scheduleChanged = inspectors !== undefined || fields.startDate !== undefined || fields.endDate !== undefined;
      if (scheduleChanged) {
        await assertInspectorsAvailable(tx, actor.officeBranchId, inspectors ?? [],
          fields.startDate ?? current.startDate,
          fields.endDate !== undefined ? fields.endDate : current.endDate, id);
      }
      if (inspectors !== undefined) {
        await tx.workOrderInspector.deleteMany({ where: { workOrderId: id } });
        if (inspectors.length) {
          const rows = inspectorRows(inspectors);
          await tx.workOrderInspector.createMany({ data: rows.map(row => ({ ...row, workOrderId: id })) });
        }
      }
      const row = await tx.workOrder.update({ where: { id }, data: { ...fields, ...quotation }, include });
      const history = await saveHistory(tx, row, before, actor, 'UPDATE');
      // Marketing is told before the commit. A failed callback aborts the
      // transaction, so the Work Order status and the mirrored quotation
      // status cannot disagree.
      if (beforeCommit && row.quotationId && row.status !== before?.status) await beforeCommit(row);
      return history;
    }, { maxWait: 10000, timeout: 20000 });
  },
  /**
   * DRAFT -> IN_PROGRESS. For quotation-based orders the stored snapshot is
   * compared against the live Marketing quotation (validated by the route before
   * the transaction starts), so an upstream call never holds database locks.
   * Contract/company-based orders transition without quotation validation.
   * The claim itself is an optimistic updateMany on status/version/revoked, so
   * concurrent starters cannot both succeed.
   */
  async start(id: string, version: number, quote: QuotationSnapshot | null, actor: Actor, beforeCommit?: (workOrder: WorkOrderSnapshot) => Promise<void>) {
    const stored = await prisma.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId }, include });
    if (!stored) throw new HttpError('Work order not found', 404);
    if (stored.version !== version || stored.status !== 'DRAFT' || stored.revoked) {
      throw new HttpError('Work order has changed or is not a draft; reload before retrying', 409);
    }
    if (stored.quotationId) {
      if (!quote) throw new HttpError('Quotation validation with Marketing service is required before starting', 409);
      const snapshot = stored.quotationSnapshot as Record<string, unknown> | null;
      // Marketing is the source of truth. Check every persisted descriptive field,
      // including items, while ignoring header bookkeeping changed by linking.
      if (!snapshot || !snapshotsMatch(
        quotationContent(toQuotationSnapshot(quote)),
        quotationContent({ ...snapshot, id: stored.quotationId, officeBranchId: stored.officeBranchId }),
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
      const history = await saveHistory(tx, row, before, actor, 'START');
      if (beforeCommit && row.quotationId) await beforeCommit(row);
      return history;
    }, { maxWait: 10000, timeout: 20000 });
  },
  async revoke(id: string, version: number, actor: Actor, beforeCommit?: (workOrder: WorkOrderSnapshot) => Promise<void>) {
    return prisma.$transaction(async tx => {
      const before = await tx.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId }, include });
      if (!before) throw new HttpError('Work order not found', 404);
      if (before.revoked) throw new HttpError('Work order is already revoked', 409);
      if (before.status === 'COMPLETED' || before.status === 'CANCELED')
        throw new HttpError('Completed or canceled work orders cannot be revoked', 409);
      const claimed = await tx.workOrder.updateMany({ where: { id, officeBranchId: actor.officeBranchId, version, revoked: false,
        status: { notIn: ['COMPLETED', 'CANCELED'] } },
        data: { revoked: true, version: { increment: 1 }, updatedById: actor.id, updatedByName: actor.name } });
      if (!claimed.count) {
        if (!await tx.workOrder.findFirst({ where: { id, officeBranchId: actor.officeBranchId } })) throw new HttpError('Work order not found', 404);
        throw new HttpError('Work order has changed or cannot be revoked; reload before retrying', 409);
      }
      const row = await tx.workOrder.findUniqueOrThrow({ where: { id }, include });
      // The history row is written before the Marketing callback so the only
      // remaining step after Marketing acknowledges is the commit itself.
      const history = await saveHistory(tx, row, before, actor, 'REVOKE');
      // Marketing is told before the commit. A failed callback aborts the
      // transaction, so the Work Order stays live and both services agree.
      if (beforeCommit && row.quotationId) await beforeCommit(row);
      return history;
    // The transaction timeout must outlive the Marketing callback timeout (10s)
    // plus the local writes. With Prisma's default 5s timeout the transaction
    // could roll back after Marketing had already cleared the quotation link,
    // leaving the two services disagreeing about the Work Order state.
    }, { maxWait: 10000, timeout: 20000 });
  },
};

