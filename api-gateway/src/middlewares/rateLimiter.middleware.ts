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

