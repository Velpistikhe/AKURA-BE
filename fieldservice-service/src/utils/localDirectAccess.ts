import { Request } from 'express';
import { env } from '../config/env.js';

export const allowsLocalDirectAccess = (): boolean =>
  env.NODE_ENV === 'development' && process.env.VERCEL !== '1';

export const isGatewayOnlyPath = (req: Request): boolean =>
  req.path === '/internal' || req.path.startsWith('/internal/');
