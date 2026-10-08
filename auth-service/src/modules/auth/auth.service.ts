import { enqueueUserSync, isFieldServiceUserSyncCandidate, isMarketingUserSyncCandidate } from '../user-sync/user-sync.service.js';
import { wakeUserSync } from '../user-sync/user-sync.delivery.js';

import bcrypt from 'bcryptjs';
import { User } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { prisma } from '../../config/db.js';
import { authRepository } from './auth.repository.js';
import { AuthResult, AuthTokens, RefreshTransactionResult, UserSanitized } from '../../types/auth.types.js';
import { HttpError, RefreshTokenRejectedError } from '../../utils/httpError.js';
import { createRefreshTokenExpiry } from '../../utils/tokenExpiry.js';
import { createAuthTokens, verifyRefreshToken } from '../../utils/tokens.js';
import { sanitizeUser } from '../../utils/userMapper.js';
import { saveUserHistory, UserAuditActor } from '../../utils/userHistory.js';
import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

// Self-service mutations are always performed by the affected user.
const selfActor = (user: User): UserAuditActor => ({
  id: user.id,
  name: `${user.firstName} ${user.lastName}`.trim() || user.username,
});

class AuthService {
  async register(
    username: string,
    password: string,
    firstName: string,
    lastName: string,
    email?: string | null,
    telp?: string | null
  ): Promise<void> {
    const passwordHash = await bcrypt.hash(password, 10);

    await prisma.$transaction(async (tx) => {
      await authRepository.createUser(tx, username, passwordHash, firstName, lastName, email, telp);
    });
  }

  async login(username: string, password: string): Promise<AuthResult> {
    const user = await authRepository.findUserByUsername(username);
    if (!user?.password) {
      throw new HttpError('Invalid username or password', 401);
    }

    if (!await bcrypt.compare(password, user.password.passwordHash)) {
      throw new HttpError('Invalid username or password', 401);
    }

    if (!user.isActive) {
      throw new HttpError('Account is inactive. Please contact administrator.', 403);
    }

    const tokens = createAuthTokens(user);
    await authRepository.saveRefreshToken(
      prisma,
      user.id,
      tokens.refreshToken,
      createRefreshTokenExpiry(),
      uuidv4()
    );
    return { user: sanitizeUser(user), tokens };
  }

  async refreshToken(refreshToken: string): Promise<AuthTokens> {
    try {
      verifyRefreshToken(refreshToken);
    } catch (error) {
      if (error instanceof HttpError) {
        await authRepository.revokeRefreshToken(prisma, refreshToken);
        throw new RefreshTokenRejectedError(error.message, error.statusCode);
      }
      throw error;
    }

    const result = await prisma.$transaction<RefreshTransactionResult>(async (tx) => {
      const tokenRow = await authRepository.findRefreshTokenForUpdate(tx, refreshToken);
      if (!tokenRow) {
        return { success: false, statusCode: 401, message: 'Refresh token is invalid' };
      }

      if (tokenRow.isRevoked) {
        await authRepository.revokeTokenFamily(tx, tokenRow.familyId);
        return {
          success: false,
          statusCode: 401,
          message: 'Refresh token reuse detected. All sessions in this token family have been revoked.',
        };
      }

      if (tokenRow.expiresAt < new Date()) {
        await authRepository.revokeRefreshToken(tx, refreshToken);
        return { success: false, statusCode: 401, message: 'Refresh token has expired' };
      }

      const now = new Date();
      const idleMilliseconds = env.JWT_REFRESH_IDLE_TIMEOUT_MINUTES * 60 * 1_000;
      if (now.getTime() - tokenRow.lastActivityAt.getTime() >= idleMilliseconds) {
        await authRepository.revokeTokenFamily(tx, tokenRow.familyId);
        return {
          success: false,
          statusCode: 401,
          message: `Refresh token session expired after ${env.JWT_REFRESH_IDLE_TIMEOUT_MINUTES} minutes of inactivity`,
        };
      }

      const user = await authRepository.findUserByIdForUpdate(tx, tokenRow.userId);
      if (!user) {
        return { success: false, statusCode: 401, message: 'Associated user no longer exists' };
      }
      if (!user.isActive) {
        await authRepository.revokeTokenFamily(tx, tokenRow.familyId);
        return { success: false, statusCode: 403, message: 'Account is inactive' };
      }

      await authRepository.revokeRefreshToken(tx, refreshToken, now);
      const tokens = createAuthTokens(user);
      await authRepository.saveRefreshToken(
        tx,
        user.id,
        tokens.refreshToken,
        createRefreshTokenExpiry(),
        tokenRow.familyId,
        now
      );
      return { success: true, tokens };
    });

    if (!result.success) {
      throw new RefreshTokenRejectedError(result.message, result.statusCode);
    }
    return result.tokens;
  }

  async logout(refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await authRepository.revokeRefreshToken(prisma, refreshToken);
    }
  }

  async updateProfile(
    userId: string,
    firstName: string,
    lastName: string,
    email?: string | null,
    telp?: string | null
  ): Promise<UserSanitized> {
    const updatedUser = await prisma.$transaction(async (tx) => {
      const user = await authRepository.findUserByIdForUpdate(tx, userId);
      if (!user) {
        throw new HttpError('User not found', 404);
      }

      const updated = await authRepository.updateProfileAtomic(
        tx,
        userId,
        firstName,
        lastName,
        user.version,
        email,
        telp
      );
      // Self-service profile edit: the authenticated user is the actor.
      await saveUserHistory(tx, updated, user, selfActor(user), 'UPDATE');
      if (isMarketingUserSyncCandidate(updated) || isMarketingUserSyncCandidate(user)
        || isFieldServiceUserSyncCandidate(updated) || isFieldServiceUserSyncCandidate(user)) {
        await enqueueUserSync(tx, updated, { previous: user });
      } else {
        logger.debug('Profile updated without user sync eligibility', {
          userId, role: updated.role, section: updated.section, isActive: updated.isActive, officeBranchId: updated.officeBranchId,
        });
      }
      return updated;
    });
    // The outbox row is committed; wake the delivery worker so it is pushed
    // immediately instead of waiting for a restart (or a pre-existing schedule).
    wakeUserSync();
    return sanitizeUser(updatedUser);
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<UserSanitized> {
    return prisma.$transaction(async (tx) => {
      const userPassword = await authRepository.findPasswordByUserIdForUpdate(tx, userId);
      if (!userPassword) {
        throw new HttpError('User password record not found', 404);
      }

      if (!await bcrypt.compare(oldPassword, userPassword.passwordHash)) {
        throw new HttpError('Incorrect current password', 400);
      }

      const passwordHash = await bcrypt.hash(newPassword, 10);
      await authRepository.updatePasswordAtomic(tx, userId, passwordHash, userPassword.version);
      await authRepository.revokeAllUserRefreshTokens(tx, userId);
      const user = await authRepository.findUserById(tx, userId);
      if (!user) {
        throw new HttpError('User not found', 404);
      }
      // Password hashes never enter history: only the redacted action is recorded.
      await saveUserHistory(tx, user, user, selfActor(user), 'PASSWORD_CHANGE');
      return sanitizeUser(user);
    });
  }

  async getProfile(userId: string): Promise<UserSanitized> {
    const user = await authRepository.findUserById(prisma, userId);
    if (!user) {
      throw new HttpError('User not found', 404);
    }
    return sanitizeUser(user);
  }
}

export const authService = new AuthService();
