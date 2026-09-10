import { Prisma } from '@prisma/client';
import { AuditActor } from '../types/auth.types.js';
import { HttpError } from './httpError.js';

// Shared by company and staff writes, including parent version changes.
export const lockCompanyBranch = async (tx: Prisma.TransactionClient, branch: string) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'company-branch:' + branch}))`;
};

export const requireCurrentVersion = (row: { version: number; revoked: boolean }, version: number) => {
  if (row.revoked || row.version !== version) {
    throw new HttpError('Data has changed or is inactive; reload before retrying', 409);
  }
};

export const recordCompanyAudit = (
  tx: Prisma.TransactionClient, officeBranchId: string, entityType: 'COMPANY' | 'COMPANY_STAFF',
  entityId: string, action: 'CREATE' | 'UPDATE' | 'DEACTIVATE' | 'COPY',
  before: unknown, after: unknown, actor: AuditActor,
) => tx.companyAuditLog.create({
  data: {
    officeBranchId, entityType, entityId, action, createdById: actor.id,
    before: before == null ? Prisma.DbNull : JSON.parse(JSON.stringify(before)),
    after: JSON.parse(JSON.stringify(after)),
  },
});
