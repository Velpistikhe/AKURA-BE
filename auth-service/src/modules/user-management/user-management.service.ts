import { UserRole, UserSection } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { HttpError } from '../../utils/httpError.js';
import { ListUsersInput } from './user-management.schemas.js';
import { userManagementRepository } from './user-management.repository.js';

export const userManagementService = {
  list: (input: ListUsersInput) => userManagementRepository.list(input),
  async get(userId: string) {
    const user = await userManagementRepository.findById(userId);
    if (!user) throw new HttpError('User not found', 404);
    return user;
  },
  setRole(actorId: string, userId: string, role: UserRole, version: number) {
    if (actorId === userId) throw new HttpError('App managers cannot change their own role', 409);
    return prisma.$transaction(async (tx) => {
      await userManagementRepository.lockInvariant(tx);
      const user = await userManagementRepository.lockById(tx, userId);
      if (!user) throw new HttpError('User not found', 404);
      if (user.version !== version) throw new HttpError('Concurrent update detected. Reload the user and try again.', 409);
      if (user.role === role) return user;
      if (user.role === UserRole.APP_MANAGER && user.isActive && await userManagementRepository.countActiveAppManagers(tx) <= 1) {
        throw new HttpError('The last active app manager cannot be demoted', 409);
      }
      return userManagementRepository.update(tx, userId, version, { role });
    });
  },
  setSection(_actorId: string, userId: string, section: UserSection | null, version: number) {
    return prisma.$transaction(async (tx) => {
      const user = await userManagementRepository.lockById(tx, userId);
      if (!user) throw new HttpError('User not found', 404);
      if (user.version !== version) throw new HttpError('Concurrent update detected. Reload the user and try again.', 409);
      if (user.section === section) return user;
      return userManagementRepository.update(tx, userId, version, { section });
    });
  },
  setStatus(actorId: string, userId: string, isActive: boolean, version: number) {
    if (actorId === userId) throw new HttpError('App managers cannot change their own active status', 409);
    return prisma.$transaction(async (tx) => {
      await userManagementRepository.lockInvariant(tx);
      const user = await userManagementRepository.lockById(tx, userId);
      if (!user) throw new HttpError('User not found', 404);
      if (user.version !== version) throw new HttpError('Concurrent update detected. Reload the user and try again.', 409);
      if (user.isActive === isActive) return user;
      if (!isActive && user.role === UserRole.APP_MANAGER && await userManagementRepository.countActiveAppManagers(tx) <= 1) {
        throw new HttpError('The last active app manager cannot be deactivated', 409);
      }
      const updated = await userManagementRepository.update(tx, userId, version, { isActive });
      if (!isActive) await userManagementRepository.revokeRefreshTokens(tx, userId);
      return updated;
    });
  },
};
