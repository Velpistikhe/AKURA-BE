import { Request } from 'express';
import type { JWTPayload } from 'jose';

export interface AccessTokenPayload extends JWTPayload {
  sub: string;
  name?: string;
  username?: string;
  role?: string;
  officeBranchId?: string | null;
  type: 'access';
}

export interface AuthenticatedRequest extends Request {
  user?: AccessTokenPayload;
}
