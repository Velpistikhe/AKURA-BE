import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AuditActor } from '../../types/auth.types.js';
import { HttpError } from '../../utils/httpError.js';
import { lockCompanyBranch } from '../../utils/companyAudit.js';
import { recordCatalogAudit, requireCatalogVersion } from '../../utils/catalogAudit.js';
import { currentBusinessDate } from '../../utils/businessDate.js';
import { recordContractHistory } from './contract-history.js';

import { formatContractDates } from '../../utils/dateOnly.js';

import { ContractPeriod, CreateContractInput, ListContractsInput, ContractHistoryQueryInput } from './contract.schemas.js';

const company = async (tx: Prisma.TransactionClient, id: string, branch: string) => {
  const row = await tx.company.findFirst({ where: { id, officeBranchId: branch, revoked: false } });
  if (!row) throw new HttpError('Company not found', 404);
  return row;
};
const saveHistory = (tx: Prisma.TransactionClient, before: Record<string, unknown> | null, contract: { id: string; version: number }, actor: AuditActor, action: string) =>
  recordContractHistory(tx, before, contract, actor, action);

// Contract versions are checked with requireCatalogVersion below.

// A single advisory lock serializes all contract lifecycle writes for a branch.

export const contractRepository = {
  resolveCompanyReference: (companyId: string, branch: string) => prisma.$transaction(async tx => {
    await company(tx, companyId, branch);
    const today = currentBusinessDate();
    const contracts = await tx.companyContract.findMany({
      where: { companyId, status: 'APPROVED', effectiveFrom: { lte: today }, effectiveUntil: { gt: today },
        company: { officeBranchId: branch, revoked: false } },
      include: { company: true, prices: { where: { isActive: true } } },
      take: 2,
    });
      if (!contracts.length) throw new HttpError('Company has no APPROVED contract within its effective period', 409);
      if (contracts.length !== 1) throw new HttpError('Company has multiple effective contracts; resolve the conflict before creating a work order', 409);
    return contracts[0];
  }, { isolationLevel: 'RepeatableRead' }),
  list: async (input: ListContractsInput, branch: string) => prisma.$transaction(async tx => {
    if (input.companyId) await company(tx, input.companyId, branch);
    const where = { ...(input.companyId ? { companyId: input.companyId } : {}), isDeleted: false, status: input.status, company: { officeBranchId: branch, revoked: false } } satisfies Prisma.CompanyContractWhereInput;
    const contracts = await tx.companyContract.findMany({ where, orderBy: [{ effectiveFrom: 'desc' }, { id: 'asc' }], skip: (input.page - 1) * input.limit, take: input.limit, include: { _count: { select: { prices: true } } } });
    const total = await tx.companyContract.count({ where });
    return { contracts: contracts.map(({ _count, ...contract }) => formatContractDates({ ...contract, hasList: _count.prices > 0 })), pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) } };
  }, { isolationLevel: 'RepeatableRead' }),
  history: async (id: string, branch: string, input: ContractHistoryQueryInput) => {
    const contract = await prisma.companyContract.findFirst({
      where: { id, company: { officeBranchId: branch, revoked: false } },
      select: { id: true },
    });
    if (!contract) throw new HttpError('Company contract not found', 404);
    const where = { companyContractId: id };
    const [history, total] = await prisma.$transaction([
      prisma.companyContractHistory.findMany({ where, orderBy: [{ version: 'desc' }, { createdAt: 'desc' }], skip: (input.page - 1) * input.limit, take: input.limit }),
      prisma.companyContractHistory.count({ where }),
    ], { isolationLevel: 'RepeatableRead' });
    return {
      contractId: id,
      history,
      pagination: { page: input.page, limit: input.limit, total, totalPages: Math.ceil(total / input.limit) },
    };
  },
  get: async (id: string, branch: string) => {
    const contract = await prisma.companyContract.findFirst({ where: { id, company: { officeBranchId: branch, revoked: false } }, include: { _count: { select: { prices: true } } } });
    if (!contract) throw new HttpError('Company contract not found', 404);
    const { _count, ...data } = contract;
    return formatContractDates({ ...data, hasList: _count.prices > 0 });
  },
  create: (data: CreateContractInput, branch: string, actor: AuditActor, _isAdmin: boolean) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const owner = await company(tx, data.companyId, branch);
    const existing = await tx.companyContract.findFirst({ where: { companyId: data.companyId, isDeleted: false, status: { in: ['DRAFT', 'REJECTED'] } } });
    if (existing) throw new HttpError('The company already has a draft or approved contract', 409);
    const row = await tx.companyContract.create({ data: { ...data, status: 'DRAFT', companySnapshot: JSON.parse(JSON.stringify(owner)), createdById: actor.id } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', null, row, actor, 'CREATE');
    await saveHistory(tx, null, row, actor, 'CREATE');
    return row;
  }),
  submit: (id: string, version: number, branch: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const before = await tx.companyContract.findFirst({ where: { id, isDeleted: false, company: { officeBranchId: branch, revoked: false } } });
    if (!before) throw new HttpError('Company contract not found', 404);
    requireCatalogVersion(before, version);
    if (before.status !== 'DRAFT' && before.status !== 'REJECTED') throw new HttpError('Only DRAFT or REJECTED contracts can be submitted', 409);
    const contractPrice = await tx.companyContractPrice.findFirst({ where: { contractId: before.id, isActive: true }, select: { id: true } });
    if (!contractPrice) throw new HttpError('At least one active contract item price is required before submission', 409);
    const after = await tx.companyContract.update({ where: { id, version }, data: { status: 'SUBMITTED', version: { increment: 1 }, updatedById: actor.id } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', before, after, actor, 'SUBMIT');
    await saveHistory(tx, before, after, actor, 'SUBMIT');
    return after;
  }),
  reject: (id: string, version: number, branch: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const before = await tx.companyContract.findFirst({ where: { id, isDeleted: false, company: { officeBranchId: branch, revoked: false } } });
    if (!before) throw new HttpError('Company contract not found', 404);
    requireCatalogVersion(before, version);
    if (before.status !== 'SUBMITTED') throw new HttpError('Only SUBMITTED contracts can be rejected', 409);
    const after = await tx.companyContract.update({ where: { id, version }, data: { status: 'REJECTED', version: { increment: 1 }, updatedById: actor.id } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', before, after, actor, 'REJECT');
    await saveHistory(tx, before, after, actor, 'REJECT');
    return after;
  }),
  approve: (id: string, version: number, branch: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const before = await tx.companyContract.findFirst({ where: { id, isDeleted: false, company: { officeBranchId: branch, revoked: false } } });
    if (!before) throw new HttpError('Company contract not found', 404);
    requireCatalogVersion(before, version);
    if (before.status !== 'SUBMITTED') throw new HttpError('Only SUBMITTED contracts can be approved', 409);
    if (before.effectiveUntil <= currentBusinessDate()) throw new HttpError('Expired contracts cannot be approved', 409);
    const excludedContractIds = [id, before.revisionOfId].filter((value): value is string => Boolean(value));
    const conflict = await tx.companyContract.findFirst({ where: { companyId: before.companyId, id: { notIn: excludedContractIds }, status: 'APPROVED', effectiveFrom: { lt: before.effectiveUntil }, effectiveUntil: { gt: before.effectiveFrom } } });
    if (conflict) throw new HttpError('Approved contract period overlaps another approved contract', 409);
    const after = await tx.companyContract.update({ where: { id, version }, data: { status: 'APPROVED', version: { increment: 1 }, updatedById: actor.id } });
    if (before.revisionOfId) {
      const old = await tx.companyContract.findUnique({ where: { id: before.revisionOfId } });
      if (!old || old.status !== 'APPROVED') throw new HttpError('The contract being revised is no longer APPROVED', 409);
      const today = currentBusinessDate();
      const oldIsActive = old.effectiveFrom <= today && old.effectiveUntil > today;
      if (oldIsActive && before.effectiveFrom <= old.effectiveFrom) throw new HttpError('A revision of an active contract must start after the original contract start date', 409);
    if (old.effectiveFrom <= before.effectiveFrom) {
      const oldUntil = new Date(before.effectiveFrom);
      oldUntil.setUTCDate(oldUntil.getUTCDate() - 1);
      if (oldUntil < old.effectiveFrom || oldUntil >= old.effectiveUntil) throw new HttpError('The revision period cannot replace the original contract period', 409);
      const oldAfter = await tx.companyContract.update({ where: { id: old.id, version: old.version }, data: { status: 'REVISED', effectiveUntil: oldUntil, version: { increment: 1 }, updatedById: actor.id } });
      await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', old, oldAfter, actor, 'REVISED');
      await saveHistory(tx, old, oldAfter, actor, 'REVISED');
    } else {
      const oldAfter = await tx.companyContract.update({ where: { id: old.id, version: old.version }, data: { status: 'REVISED', effectiveUntil: old.effectiveFrom, version: { increment: 1 }, updatedById: actor.id } });
      await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', old, oldAfter, actor, 'REVISED');
      await saveHistory(tx, old, oldAfter, actor, 'REVISED');
    }
    }
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', before, after, actor, 'APPROVE');
    await saveHistory(tx, before, after, actor, 'APPROVE');
    return after;
  }),
  update: (id: string, data: ContractPeriod, branch: string, actor: AuditActor, isAdmin = true) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const before = await tx.companyContract.findFirst({ where: { id, company: { officeBranchId: branch, revoked: false } } });
    if (!before) throw new HttpError('Company contract not found', 404);
    requireCatalogVersion(before, data.version);
    if (before.status === 'APPROVED' && !isAdmin) throw new HttpError('Only marketing admin can update approved contracts', 403);
    if (!['DRAFT', 'REJECTED', 'APPROVED'].includes(before.status)) throw new HttpError('Contract status cannot be updated', 409);
    if (before.status === 'REJECTED') {
      // Rejected corrections must re-enter the submit workflow.
    }
    if (before.status === 'APPROVED') {
      const conflict = await tx.companyContract.findFirst({ where: { companyId: before.companyId, id: { not: id }, status: { in: ['APPROVED', 'REVISED', 'TERMINATED'] }, effectiveFrom: { lt: data.effectiveUntil }, effectiveUntil: { gt: data.effectiveFrom } } });
      if (conflict) throw new HttpError('Contract period overlaps another contract', 409);
    }
    const after = await tx.companyContract.update({ where: { id, version: data.version }, data: {
      status: before.status === 'REJECTED' ? 'DRAFT' : undefined,
      contractNumber: data.contractNumber, contractDate: data.contractDate,
      effectiveFrom: data.effectiveFrom, effectiveUntil: data.effectiveUntil,
      updatedById: actor.id, version: { increment: 1 },
    } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', before, after, actor, 'UPDATE');
    await saveHistory(tx, before, after, actor, 'UPDATE');
    return after;
  }),
  revise: (id: string, data: ContractPeriod, branch: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const before = await tx.companyContract.findFirst({ where: { id, company: { officeBranchId: branch, revoked: false } } });
    if (!before) throw new HttpError('Company contract not found', 404);
    requireCatalogVersion(before, data.version);
    if (before.status !== 'APPROVED') throw new HttpError('Only APPROVED contracts can be revised', 409);
    const existingRevision = await tx.companyContract.findFirst({ where: { revisionOfId: before.id, isDeleted: false, status: { in: ['DRAFT', 'SUBMITTED', 'REJECTED'] } } });
    if (existingRevision) throw new HttpError('The contract already has a DRAFT revision', 409);
    const row = await tx.companyContract.create({ data: {
      companyId: before.companyId, contractNumber: data.contractNumber, contractDate: data.contractDate,
      effectiveFrom: data.effectiveFrom, effectiveUntil: data.effectiveUntil, status: 'DRAFT',
      companySnapshot: before.companySnapshot ?? Prisma.DbNull, revisionOfId: before.id, createdById: actor.id,
    } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', null, row, actor, 'REVISE');
    await saveHistory(tx, null, row, actor, 'REVISE');
    return row;
  }),
  terminate: (id: string, version: number, terminatedAt: Date, branch: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const before = await tx.companyContract.findFirst({ where: { id, company: { officeBranchId: branch, revoked: false } } });
    if (!before) throw new HttpError('Company contract not found', 404);
    requireCatalogVersion(before, version);
    if (before.status !== 'APPROVED') throw new HttpError('Only approved contracts can be terminated', 409);
    if (terminatedAt < before.effectiveFrom || terminatedAt > before.effectiveUntil) throw new HttpError('terminatedAt must be within the contract period', 400);
    const after = await tx.companyContract.update({ where: { id, version }, data: { status: 'TERMINATED', effectiveUntil: terminatedAt, version: { increment: 1 }, updatedById: actor.id } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', before, after, actor, 'DEACTIVATE');
    await saveHistory(tx, before, after, actor, 'TERMINATE');
    return after;
  }),
  delete: (id: string, version: number, branch: string, actor: AuditActor) => prisma.$transaction(async tx => {
    await lockCompanyBranch(tx, branch);
    const before = await tx.companyContract.findFirst({ where: { id, company: { officeBranchId: branch, revoked: false } } });
    if (!before) throw new HttpError('Company contract not found', 404);
    requireCatalogVersion(before, version);
    if (before.status !== 'DRAFT' && before.status !== 'REJECTED') throw new HttpError('Only DRAFT or REJECTED contracts can be deleted', 409);
    const after = await tx.companyContract.update({ where: { id, version }, data: { isDeleted: true, version: { increment: 1 }, updatedById: actor.id } });
    await recordCatalogAudit(tx, branch, 'COMPANY_CONTRACT', before, after, actor, 'DELETE');
    await saveHistory(tx, before, after, actor, 'DELETE');
    return after;
  }),
};
