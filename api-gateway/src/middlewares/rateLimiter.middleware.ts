import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

export const globalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (_req, res) => Boolean(res.locals.serviceCaller),
  message: {
    status: 429,
    success: false,
    message: 'Too many requests from this IP, please try again later.',
  },
});

/**
 * A tighter limit for credential submission endpoints. The global limiter is
 * per IP over a long window, which is too permissive for brute-force attempts
 * against a single account. This one caps attempts per IP on a short window.
 */
export const authRateLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  // Internal service traffic does not submit user credentials and must not be
  // throttled by the user-facing authentication limit.
  skip: (_req, res) => Boolean(res.locals.serviceCaller),
  message: {
    status: 429,
    success: false,
    message: 'Too many authentication attempts, please try again later.',
  },
});

