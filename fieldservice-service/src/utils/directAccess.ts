import { env } from '../config/env.js';

export const isDirectMfeAccess = (): boolean =>
  env.DIRECT_MFE_ACCESS && env.NODE_ENV === 'development' && process.env.VERCEL !== '1';
