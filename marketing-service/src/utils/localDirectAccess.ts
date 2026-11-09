import { Request } from 'express';
import { env } from '../config/env.js';

/**
 * Direct browser access to a service running on the developer machine.
 *
 * Enabled only while NODE_ENV is development and the process is not hosted on
 * Vercel. A deployed service keeps the unconditional gateway-secret check even
 * when NODE_ENV is development.
 */
export const allowsLocalDirectAccess = (): boolean =>
  env.NODE_ENV === 'development' && process.env.VERCEL !== '1';

/** Internal callbacks and delivery endpoints stay gateway-only. */
export const isGatewayOnlyPath = (req: Request): boolean =>
  req.path === '/internal' || req.path.startsWith('/internal/');
