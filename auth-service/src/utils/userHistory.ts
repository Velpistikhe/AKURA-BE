import { Prisma, PrismaClient } from '@prisma/client';

export type UserAuditActor = { id: string; name: string };

// Normalizes Prisma rows (officeBranchName) and API rows (branch) so before and
// after snapshots always expose the same field set.
interface UserSnapshotSource {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string | null;
  telp: string | null;
  role: string;
  section: string | null;
  officeBranchId: string | null;
  officeBranchName?: string | null;
  branch?: string | null;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export const userSnapshot = (user: UserSnapshotSource): Record<string, unknown> => ({
  id: user.id,
  username: user.username,
  firstName: user.firstName,
  lastName: user.lastName,
  email: user.email,
  telp: user.telp,
  role: user.role,
  section: user.section,
  officeBranchId: user.officeBranchId,
  branch: user.branch ?? user.officeBranchName ?? null,
  isActive: user.isActive,
  version: user.version,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

export async function saveUserHistory(
  tx: Prisma.TransactionClient | PrismaClient,
  user: UserSnapshotSource,
  before: UserSnapshotSource | null,
  actor: UserAuditActor,
  action: 'CREATE' | 'UPDATE' | 'PASSWORD_CHANGE',
): Promise<void> {
  const beforeSnapshot = before ? userSnapshot(before) : null;
  const snapshot = userSnapshot(user);
  // id, timestamps and version are context, not user-editable data fields.
  const fields = Object.keys(snapshot).filter((field) => !['id', 'createdAt', 'updatedAt', 'version'].includes(field));
  const changes = fields.flatMap((field) => {
    const beforeValue = beforeSnapshot?.[field] ?? null;
    const afterValue = snapshot[field] ?? null;
    return JSON.stringify(beforeValue) === JSON.stringify(afterValue)
      ? []
      : [{ field, before: beforeValue, after: afterValue }];
  });
  // Password material never enters history; the action itself documents the change.
  if (action === 'PASSWORD_CHANGE') {
    changes.push({ field: 'password', before: '[REDACTED]', after: '[REDACTED]' });
  }
  await tx.userHistory.create({ data: {
    userId: user.id,
    version: user.version,
    action,
    beforeSnapshot: beforeSnapshot ? JSON.parse(JSON.stringify(beforeSnapshot)) : Prisma.DbNull,
    snapshot: JSON.parse(JSON.stringify(snapshot)),
    changes: JSON.parse(JSON.stringify(changes)),
    createdById: actor.id,
    createdByName: actor.name,
  } });
}
