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

export const saveCompanyStaffHistory = async (
  tx: Prisma.TransactionClient, companyStaffId: string, actor: AuditActor,
  action: 'CREATE' | 'UPDATE' | 'DEACTIVATE',
) => {
  const staff = await tx.companyStaff.findUniqueOrThrow({
    where: { id: companyStaffId },
    include: {
      company: { select: { id: true, name: true, type: true, version: true } },
    },
  });
  await tx.companyStaffHistory.create({ data: {
    companyStaffId, version: staff.version, action,
    snapshot: JSON.parse(JSON.stringify(staff)), createdById: actor.id, createdByName: actor.name,
  } });
};
