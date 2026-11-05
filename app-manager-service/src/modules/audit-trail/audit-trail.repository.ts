import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { buildListQuery, buildPagination, defineSortRules } from '../../utils/listQuery.js';
import { ListAuditTrailInput } from './audit-trail.schemas.js';

export interface AuditTrailEntry {
  id: string;
  module: string;
  entityType: string;
  entityId: string;
  /**
   * The version of the entity state this entry describes.
   *
   * It is a string, because the database holds a BigInt and JSON has no
   * BigInt.
   */
  version: string;
  action: string;
  before: unknown;
  after: unknown;
  officeBranchId: string | null;
  createdById: string;
  createdByName: string;
  createdAt: Date;
}

export interface PaginatedAuditTrail {
  entries: AuditTrailEntry[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

class AuditTrailRepository {
  /**
   * The version is a BigInt in the database, because it holds both a plain
   * counter and a timestamp in milliseconds. JSON has no BigInt, so it is
   * serialised as a string.
   */
  private static toEntry(row: Prisma.AuditLogGetPayload<object>): AuditTrailEntry {
    return { ...row, version: row.version.toString() };
  }

  async list(input: ListAuditTrailInput): Promise<PaginatedAuditTrail> {
    const query = buildListQuery<ListAuditTrailInput['sortBy'] & string, ListAuditTrailInput, Prisma.AuditLogWhereInput, Prisma.AuditLogOrderByWithRelationInput>(input, {
      filters: {
        module: (module: string) => ({ module }),
        entityType: (entityType: string) => ({ entityType }),
        entityId: (entityId: string) => ({ entityId }),
        action: (action: string) => ({ action }),
      },
      defaultSort: { createdAt: 'desc' },
      sorts: defineSortRules<NonNullable<ListAuditTrailInput['sortBy']>, Prisma.AuditLogOrderByWithRelationInput>({
        createdAt: (direction) => ({ createdAt: direction }),
        module: (direction) => ({ module: direction }),
        entityType: (direction) => ({ entityType: direction }),
        action: (direction) => ({ action: direction }),
      }),
    });

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({ ...query, orderBy: { createdAt: 'desc' } }),
      prisma.auditLog.count({ where: query.where }),
    ]);

    return {
      entries: rows.map((row) => AuditTrailRepository.toEntry(row)),
      pagination: buildPagination(input.page, input.limit, total),
    };
  }

  /** The trail of one entity, newest first. */
  async listForEntity(entityId: string): Promise<AuditTrailEntry[]> {
    const rows = await prisma.auditLog.findMany({ where: { entityId }, orderBy: { createdAt: 'desc' } });
    return rows.map((row) => AuditTrailRepository.toEntry(row));
  }
}

export const auditTrailRepository = new AuditTrailRepository();
