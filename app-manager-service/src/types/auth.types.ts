import { Request } from 'express';
import { JWTPayload } from 'jose';

export interface AccessTokenPayload extends JWTPayload {
  sub: string;
  name?: string;
  username?: string;
  role?: string;
  type: 'access';
}

export interface AuthenticatedRequest extends Request {
  user?: AccessTokenPayload;
}
