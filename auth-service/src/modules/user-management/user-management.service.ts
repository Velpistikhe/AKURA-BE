import { UserRole } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { saveUserHistory, UserAuditActor } from '../../utils/userHistory.js';
import { ListUsersInput, UpdateUserInput } from './user-management.schemas.js';
import { userManagementRepository } from './user-management.repository.js';
import { enqueueUserSync, isFieldServiceUserSyncCandidate, isMarketingUserSyncCandidate } from '../user-sync/user-sync.service.js';
import { wakeUserSync } from '../user-sync/user-sync.delivery.js';

const ensureActiveVersion = (user: { version: number; isActive: boolean }, version: number): void => {
  if (user.version !== version) {
    throw new HttpError('Concurrent update detected. Reload the user and try again.', 409);
  }
  if (!user.isActive) {
    throw new HttpError('Inactive users cannot be updated', 409);
  }
};


// Exposes the stored office branch display name under the public `branch` key
// while keeping officeBranchId for assignment/filtering.
const presentUser = <T extends { officeBranchName?: string | null }>({ officeBranchName, ...user }: T): Omit<T, 'officeBranchName'> & { branch: string | null } => ({
  ...user,
  branch: officeBranchName ?? null,
});

export const userManagementService = {
  list: async (input: ListUsersInput) => {
    const result = await userManagementRepository.list(input);
    return { ...result, users: result.users.map(presentUser) };
  },
  async get(userId: string) {
    const user = await userManagementRepository.findById(userId);
    if (!user) throw new HttpError('User not found', 404);
    return presentUser(user);
  },
  /**
   * Branch-scoped inspector validation used by Field Service when a work
   * order starts. Auth is the source of truth: only active FIELD_SERVICE users
   * of the caller branch are returned, each with its canonical display name so
   * callers can compare the submitted ID/name pairs before the transition.
   */
  async inspectors(userId: string, ids: string[], store: { user: { findUnique: typeof prisma.user.findUnique; findMany: typeof prisma.user.findMany } } = prisma) {
    const actor = await store.user.findUnique({ where: { id: userId }, select: { officeBranchId: true } });
    if (!actor?.officeBranchId) return { inspectors: [] };
    const rows = await store.user.findMany({
      where: { id: { in: ids }, officeBranchId: actor.officeBranchId, section: 'FIELD_SERVICE', isActive: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    // The display name is rebuilt exactly like the Field Service options snapshot.
    return { inspectors: rows.map(({ id, firstName, lastName }) => ({ id, name: `${firstName} ${lastName}`.trim() })) };
  },
  async update(actor: UserAuditActor, userId: string, data: UpdateUserInput) {
    const updated = await prisma.$transaction(async (tx) => {
      const user = await userManagementRepository.lockById(tx, userId);
      if (!user) throw new HttpError('User not found', 404);
      ensureActiveVersion(user, data.version);

      const roleChanged = data.role !== undefined && data.role !== user.role;
      const statusChanged = data.isActive !== undefined && data.isActive !== user.isActive;
      const sectionChanged = data.section !== undefined && data.section !== user.section;
      const branchChanged = data.officeBranchId !== undefined
        && (data.officeBranchId !== user.officeBranchId || data.branch !== user.officeBranchName);
      const emailChanged = data.email !== undefined && data.email !== user.email;
      const telpChanged = data.telp !== undefined && data.telp !== user.telp;

      if (actor.id === userId && roleChanged) {
        throw new HttpError('App managers cannot change their own role', 409);
      }
      if (actor.id === userId && statusChanged) {
        throw new HttpError('App managers cannot change their own active status', 409);
      }
      if (!roleChanged && !statusChanged && !sectionChanged && !branchChanged && !emailChanged && !telpChanged) {
        return userManagementRepository.findById(userId);
      }

      if (roleChanged || statusChanged) await userManagementRepository.lockInvariant(tx);
      const removesActiveAppManager = user.role === UserRole.APP_MANAGER
        && user.isActive
        && ((roleChanged && data.role !== UserRole.APP_MANAGER) || (statusChanged && data.isActive === false));
      if (removesActiveAppManager && await userManagementRepository.countActiveAppManagers(tx) <= 1) {
        throw new HttpError('The last active app manager cannot be demoted or deactivated', 409);
      }

      const updated = await userManagementRepository.update(tx, userId, data.version, {
        ...(roleChanged && { role: data.role }),
        ...(sectionChanged && { section: data.section }),
        // The branch id and its display name are always written together.
        ...(branchChanged && { officeBranchId: data.officeBranchId, officeBranchName: data.branch }),
        ...(emailChanged && { email: data.email ?? null }),
        ...(telpChanged && { telp: data.telp ?? null }),
        ...(statusChanged && { isActive: data.isActive }),
      });
      // Every administrative change writes one append-only history row inside the
      // same transaction, including the old/new branch id AND branch name.
      await saveUserHistory(tx, updated, user, actor, 'UPDATE');
      if (statusChanged && data.isActive === false) {
        await userManagementRepository.revokeRefreshTokens(tx, userId);
      }
      // Marketing and Field Service only cache eligible snapshots: enqueue when
      // either the previous or resulting snapshot is a candidate, so eligible
      // users are added/updated and users that lose eligibility are removed.
      if (isMarketingUserSyncCandidate(user) || isMarketingUserSyncCandidate(updated)
        || isFieldServiceUserSyncCandidate(user) || isFieldServiceUserSyncCandidate(updated)) {
        await enqueueUserSync(tx, updated, { previous: user });
      }
      return updated;
    });
    wakeUserSync();
    return updated ? presentUser(updated) : updated;
  },
};
