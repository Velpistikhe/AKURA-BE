import { Request } from 'express';
import { env } from '../config/env.js';

export const isLocalDevelopment = (): boolean =>
  env.NODE_ENV === 'development' && process.env.VERCEL !== '1' && env.LOCAL_DIRECT_ACCESS;

// Inspect the TCP peer, never client-controlled forwarding headers.
export const isLocalDirectRequest = (req: Request): boolean =>
  isLocalDevelopment() && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '');
