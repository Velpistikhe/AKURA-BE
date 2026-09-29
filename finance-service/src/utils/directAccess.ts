import { env } from '../config/env.js';

/**
 * Direct Finance microfrontend access outside the API Gateway.
 *
 * Only enabled when DIRECT_MFE_ACCESS=true, NODE_ENV=development and the
 * process is not running on Vercel. Every other environment keeps the
 * mandatory x-gateway-secret check; there is no loopback bypass.
 */
export const isDirectMfeAccess = (): boolean =>
  env.DIRECT_MFE_ACCESS && env.NODE_ENV === 'development' && process.env.VERCEL !== '1';
