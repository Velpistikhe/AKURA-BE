import { Request } from 'express';
import type { JWTPayload } from 'jose';

export interface AccessTokenPayload extends JWTPayload {
  sub: string;
  name?: string;
  username?: string;
  type: 'access';
  role?: string;
  section?: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AccessTokenPayload;
}

export interface AuthUser {
  id: string;
  role: string;
  section: string | null;
  isActive: boolean;
}

declare global {
  namespace Express {
    interface Locals {
      authUser?: AuthUser;
    }
  }
}
