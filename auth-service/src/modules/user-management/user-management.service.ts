import { UserRole } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { ListUsersInput, UpdateUserInput } from './user-management.schemas.js';
import { userManagementRepository } from './user-management.repository.js';
import { enqueueUserSync } from '../user-sync/user-sync.service.js';
import { wakeUserSync } from '../user-sync/user-sync.delivery.js';

const ensureActiveVersion = (user: { version: number; isActive: boolean }, version: number): void => {
  if (user.version !== version) {
    throw new HttpError('Concurrent update detected. Reload the user and try again.', 409);
  }
  if (!user.isActive) {
    throw new HttpError('Inactive users cannot be updated', 409);
  }
};

// Marketing caches only active users holding BOTH the ADMIN role and the
// MARKETING section within an assigned office branch.
const isMarketingAdminCandidate = (user: { role: string; section: string | null; isActive: boolean; officeBranchId: string | null }): boolean =>
  user.role === 'ADMIN' && user.section === 'MARKETING' && user.isActive && Boolean(user.officeBranchId);

export const userManagementService = {
  list: (input: ListUsersInput) => userManagementRepository.list(input),
  async get(userId: string) {
    const user = await userManagementRepository.findById(userId);
    if (!user) throw new HttpError('User not found', 404);
    return user;
  },
  async update(actorId: string, userId: string, data: UpdateUserInput) {
    const updated = await prisma.$transaction(async (tx) => {
      const user = await userManagementRepository.lockById(tx, userId);
      if (!user) throw new HttpError('User not found', 404);
      ensureActiveVersion(user, data.version);

      const roleChanged = data.role !== undefined && data.role !== user.role;
      const statusChanged = data.isActive !== undefined && data.isActive !== user.isActive;
      const sectionChanged = data.section !== undefined && data.section !== user.section;
      const officeBranchChanged = data.officeBranchId !== undefined && data.officeBranchId !== user.officeBranchId;
      const emailChanged = data.email !== undefined && data.email !== user.email;
      const telpChanged = data.telp !== undefined && data.telp !== user.telp;

      if (actorId === userId && roleChanged) {
        throw new HttpError('App managers cannot change their own role', 409);
      }
      if (actorId === userId && statusChanged) {
        throw new HttpError('App managers cannot change their own active status', 409);
      }
      if (!roleChanged && !statusChanged && !sectionChanged && !officeBranchChanged && !emailChanged && !telpChanged) {
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
        ...(officeBranchChanged && { officeBranchId: data.officeBranchId }),
        ...(emailChanged && { email: data.email ?? null }),
        ...(telpChanged && { telp: data.telp ?? null }),
        ...(statusChanged && { isActive: data.isActive }),
      });
      if (statusChanged && data.isActive === false) {
        await userManagementRepository.revokeRefreshTokens(tx, userId);
      }
      // Marketing only caches active ADMIN MARKETING users: enqueue when either
      // the previous or resulting snapshot is (or was) a candidate, so eligible
      // users are added/updated and users that lose eligibility are removed.
      if (isMarketingAdminCandidate(user) || isMarketingAdminCandidate(updated)) {
        await enqueueUserSync(tx, updated);
      }
      return updated;
    });
    wakeUserSync();
    return updated;
  },
};
