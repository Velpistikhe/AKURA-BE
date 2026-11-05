import { NextFunction, Request, Response } from 'express';
import { UserRole, UserSection } from '@prisma/client';

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

const readHeader = (req: Request, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/**
 * Identity for this service comes from the API Gateway, which verifies the
 * access token and forwards the result in the X-User-* headers. The gateway
 * strips any inbound X-User-* header before injecting its own, so a client
 * cannot spoof them. Because the gateway secret already proves the request
 * arrived through the gateway, this service does not verify the token itself.
 */
const readGatewayIdentity = (req: Request): AuthUser | null => {
  const id = readHeader(req, 'x-user-id');
  const role = readHeader(req, 'x-user-role') as UserRole | undefined;
  if (!id || !role || !Object.values(UserRole).includes(role)) return null;

  const sectionHeader = readHeader(req, 'x-user-section');
  const section = sectionHeader && Object.values(UserSection).includes(sectionHeader as UserSection)
    ? sectionHeader as UserSection
    : null;

  return {
    id,
    role,
    section,
    officeBranchId: readHeader(req, 'x-office-branch-id') ?? null,
    firstName: readHeader(req, 'x-user-name'),
    username: readHeader(req, 'x-user-username'),
  };
};

/**
 * Factory middleware: resolve the gateway-verified identity and validate the
 * role.
 *
 * Flow:
 *  1. Read the identity headers the gateway injected after verifying the JWT
 *  2. Validate the role -> continue or reject the request
 *  3. Store the identity in res.locals for the controller
 */
const requireRole = (allowedRoles: UserRole[]) =>
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const requestId = typeof req.headers['x-request-id'] === 'string'
      ? req.headers['x-request-id']
      : undefined;

    const authUser = readGatewayIdentity(req);
    if (!authUser) {
      res.status(401).json({ status: 401, success: false, message: 'Unauthorized: missing or invalid identity', requestId });
      return;
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(authUser.role)) {
      res.status(403).json({
        status: 403,
        success: false,
        message: `Access denied: required role is ${allowedRoles.join(' or ')}`,
        requestId,
      });
      return;
    }

    res.locals.authUser = authUser;
    next();
  };

/** Hanya user dengan role app_manager */
export const requireAppManager = requireRole([UserRole.APP_MANAGER]);

/** Semua role aktif - hanya memvalidasi identitas dari gateway */
export const requireAuthenticated = requireRole([UserRole.USER, UserRole.ADMIN, UserRole.APP_MANAGER]);

