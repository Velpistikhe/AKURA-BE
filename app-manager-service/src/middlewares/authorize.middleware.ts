import { NextFunction, Request, Response } from 'express';
import { UserRole, UserSection } from '@prisma/client';
import { env } from '../config/env.js';
import { getAccessToken } from '../utils/requestTokens.js';
import { verifyAccessToken } from '../utils/tokens.js';

export interface AuthUser {
  id: string;
  role: UserRole;
  section: UserSection | null;
  officeBranchId?: string | null;
  firstName?: string;
  lastName?: string;
  username?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Locals {
      authUser?: AuthUser;
    }
  }
}

/**
 * Verifikasi user ke auth-service — ambil isActive dan section terkini.
 * Menggunakan endpoint GET /me dengan forward access token.
 */
const fetchAuthUserProfile = async (token: string, requestId?: string): Promise<{
  id: string; role: UserRole; section: UserSection | null; isActive: boolean;
  officeBranchId?: string | null; firstName?: string; lastName?: string; username?: string;
} | null> => {
  try {
    const res = await fetch(`${env.API_GATEWAY_URL}/api/v1/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-service-name': 'app-manager-service',
        'x-service-secret': env.GATEWAY_SECRET,
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
    });
    if (!res.ok) return null;
    const json = await res.json() as { data?: AuthUser & { isActive: boolean } };
    return json.data ?? null;
  } catch {
    return null;
  }
};

/**
 * Factory middleware: verifikasi token, validasi user aktif, validasi role.
 *
 * Alur:
 *  1. Ambil & verifikasi access token via JWKS → dapatkan userId + role dari payload
 *  2. Panggil auth-service GET /me → dapatkan isActive + section terkini (no direct DB)
 *  3. Validasi role → lanjutkan atau tolak request
 *  4. Simpan authUser ke res.locals untuk digunakan controller
 */
const requireRole = (allowedRoles: UserRole[]) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const requestId = typeof req.headers['x-request-id'] === 'string'
      ? req.headers['x-request-id']
      : undefined;

    // 1. Verifikasi token & ambil payload
    const token = getAccessToken(req);
    if (!token) {
      res.status(401).json({ status: 401, success: false, message: 'Unauthorized: missing access token', requestId });
      return;
    }

    let tokenPayload: { sub: string; role?: string };
    try {
      tokenPayload = await verifyAccessToken(token);
    } catch {
      res.status(401).json({ status: 401, success: false, message: 'Unauthorized: invalid or expired access token', requestId });
      return;
    }

    // 2. Validasi role cepat dari token payload (tanpa DB call)
    const tokenRole = tokenPayload.role as UserRole | undefined;
    if (allowedRoles.length > 0 && (!tokenRole || !allowedRoles.includes(tokenRole))) {
      res.status(403).json({
        status: 403,
        success: false,
        message: `Access denied: required role is ${allowedRoles.join(' or ')}`,
        requestId,
      });
      return;
    }

    // 3. Verifikasi ke auth-service: pastikan user masih aktif & ambil data terkini
    try {
      const profile = await fetchAuthUserProfile(token, requestId);

      if (!profile || profile.id !== tokenPayload.sub) {
        res.status(401).json({ status: 401, success: false, message: 'Unauthorized: user not found', requestId });
        return;
      }

      if (!profile.isActive) {
        res.status(403).json({ status: 403, success: false, message: 'Account is inactive', requestId });
        return;
      }

      // Double-check role dari DB (sumber kebenaran) bukan hanya dari token
      if (allowedRoles.length > 0 && !allowedRoles.includes(profile.role)) {
        res.status(403).json({
          status: 403,
          success: false,
          message: `Access denied: required role is ${allowedRoles.join(' or ')}`,
          requestId,
        });
        return;
      }

      // 4. Simpan ke res.locals
      res.locals.authUser = { id: profile.id, role: profile.role, section: profile.section,
        officeBranchId: profile.officeBranchId, firstName: profile.firstName, lastName: profile.lastName, username: profile.username };

      next();
    } catch (error) {
      next(error);
    }
  };

/** Hanya user aktif dengan role app_manager */
export const requireAppManager = requireRole([UserRole.APP_MANAGER]);

/** Hanya user aktif dengan role admin */
export const requireAdmin = requireRole([UserRole.ADMIN]);

/** Hanya user aktif dengan role admin atau app_manager */
export const requireAdminOrAppManager = requireRole([UserRole.ADMIN, UserRole.APP_MANAGER]);

/** Semua user aktif (semua role) — hanya memvalidasi token + status aktif */
export const requireAuthenticated = requireRole([UserRole.USER, UserRole.ADMIN, UserRole.APP_MANAGER]);
