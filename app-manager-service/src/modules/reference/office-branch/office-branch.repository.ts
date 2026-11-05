import { Prisma } from '@prisma/client';
import { prisma } from '../../../config/db.js';
import { HttpError } from '../../../utils/httpError.js';
import { buildListQuery, buildPagination, defineSortRules } from '../../../utils/listQuery.js';
import { recordAudit, type AuditActor } from '../../../utils/audit.js';
import { CreateOfficeBranchInput, ListOfficeBranchesInput, UpdateOfficeBranchInput } from './office-branch.schemas.js';
import { ManagedOfficeBranch, OfficeBranchOption, PaginatedOfficeBranches } from './office-branch.types.js';

const officeBranchSelect = {
  id: true,
  name: true,
  address: true,
  telp: true,
  email: true,
  isHead: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OfficeBranchSelect;

/**
 * The version of an office branch for the audit trail.
 *
 * The row has no version column, so the timestamp of the change is used. The
 * audit entry is unique per (entity, version), and the timestamp changes on
 * every write, so each write produces exactly one entry.
 */
const auditVersion = (row: { updatedAt: Date }): number => row.updatedAt.getTime();

const throwHeadConflict = (error: unknown): never => {
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
    throw new HttpError('A head office branch already exists', 409);
  }
  throw error;
};

class OfficeBranchRepository {
  listOptions(): Promise<OfficeBranchOption[]> {
    return prisma.officeBranch.findMany({
      select: { id: true, name: true },
      orderBy: [{ isHead: 'desc' }, { name: 'asc' }],
    });
  }

  async list(input: ListOfficeBranchesInput): Promise<PaginatedOfficeBranches> {
    const query = buildListQuery(input, {
      filters: {
        search: (search) => ({ OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { address: { contains: search, mode: 'insensitive' } },
          { telp: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ] }),
        isHead: (isHead) => ({ isHead }),
      },
      defaultSort: { createdAt: 'desc' },
      sorts: defineSortRules<NonNullable<ListOfficeBranchesInput['sortBy']>, Prisma.OfficeBranchOrderByWithRelationInput>({
        name: (direction) => ({ name: direction }),
        address: (direction) => ({ address: direction }),
        telp: (direction) => ({ telp: direction }),
        email: (direction) => ({ email: direction }),
        isHead: (direction) => ({ isHead: direction }),
        updatedAt: (direction) => ({ updatedAt: direction }),
      }),
    });
    const [officeBranches, total] = await Promise.all([
      prisma.officeBranch.findMany({ ...query, select: officeBranchSelect }),
      prisma.officeBranch.count({ where: query.where }),
    ]);
    return { officeBranches, pagination: buildPagination(input.page, input.limit, total) };
  }

  findById(id: string): Promise<ManagedOfficeBranch | null> {
    return prisma.officeBranch.findUnique({ where: { id }, select: officeBranchSelect });
  }

  async create(data: CreateOfficeBranchInput, actor: AuditActor): Promise<ManagedOfficeBranch> {
    try {
      if (data.isHead) {
        return await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('office_branch_head'))`;
          const existingHead = await tx.officeBranch.findFirst({ where: { isHead: true }, select: { id: true } });
          if (existingHead) throw new HttpError('A head office branch already exists', 409);
          const created = await tx.officeBranch.create({ data, select: officeBranchSelect });
          await recordAudit(tx, {
            module: 'reference',
            entityType: 'OFFICE_BRANCH',
            entityId: created.id,
            version: auditVersion(created),
            action: 'CREATE',
            before: null,
            after: created,
            actor,
          });
          return created;
        });
      }
      const created = await prisma.$transaction(async (tx) => {
        const row = await tx.officeBranch.create({ data, select: officeBranchSelect });
        await recordAudit(tx, {
          module: 'reference',
          entityType: 'OFFICE_BRANCH',
          entityId: row.id,
          version: auditVersion(row),
          action: 'CREATE',
          before: null,
          after: row,
          actor,
        });
        return row;
      });
      return created;
    } catch (error) {
      return throwHeadConflict(error);
    }
  }

  async update(id: string, data: UpdateOfficeBranchInput, actor: AuditActor): Promise<ManagedOfficeBranch> {
    try {
      if (data.isHead) {
        return await prisma.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('office_branch_head'))`;
          const existingHead = await tx.officeBranch.findFirst({
            where: { isHead: true, id: { not: id } },
            select: { id: true },
          });
          if (existingHead) throw new HttpError('A head office branch already exists', 409);
          const before = await tx.officeBranch.findUniqueOrThrow({ where: { id }, select: officeBranchSelect });
          const updated = await tx.officeBranch.update({ where: { id }, data, select: officeBranchSelect });
          await recordAudit(tx, {
            module: 'reference',
            entityType: 'OFFICE_BRANCH',
            entityId: updated.id,
            version: auditVersion(updated),
            action: 'UPDATE',
            before,
            after: updated,
            actor,
          });
          return updated;
        });
      }
      const updated = await prisma.$transaction(async (tx) => {
        const before = await tx.officeBranch.findUniqueOrThrow({ where: { id }, select: officeBranchSelect });
        const row = await tx.officeBranch.update({ where: { id }, data, select: officeBranchSelect });
        await recordAudit(tx, {
          module: 'reference',
          entityType: 'OFFICE_BRANCH',
          entityId: row.id,
          version: auditVersion(row),
          action: 'UPDATE',
          before,
          after: row,
          actor,
        });
        return row;
      });
      return updated;
    } catch (error) {
      return throwHeadConflict(error);
    }
  }
}

export const officeBranchRepository = new OfficeBranchRepository();
