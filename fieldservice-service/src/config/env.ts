import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Refuses a development configuration that points at a remote system.
 *
 * The development environment must never reach a deployed database or a
 * deployed service. A remote target in a development `.env` is almost always
 * a copy/paste mistake, and it would let a local run modify real data.
 */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];

const assertLocalTarget = (label: string, value: string, context: z.RefinementCtx): void => {
  let host: string;
  try {
    host = new URL(value.includes('://') ? value : `postgresql://${value}`).hostname;
  } catch {
    // A value that is not a URL cannot be checked here; the schema validates
    // the format separately.
    return;
  }
  if (host && !LOCAL_HOSTS.includes(host)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${label} must point at a local host in development, but it points at "${host}". `
        + 'A development environment must never reach a deployed system.',
    });
  }
};

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(5005),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  GATEWAY_SECRET: z.string().min(1, 'GATEWAY_SECRET is required'),
  API_GATEWAY_URL: z.string({ required_error: 'API_GATEWAY_URL is required' })
    .url('API_GATEWAY_URL must be a valid URL')
    .transform((value) => value.replace(/\/$/, '')),
  // Direct browser access is development-only and never bypasses user auth.
  DIRECT_MFE_ACCESS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  DIRECT_MFE_ORIGIN: z.string().url().default('http://localhost:4173'),
  // Shared secret for Auth's FIELD_SERVICE user read-model delivery.
  WORK_ORDER_SYNC_SECRET: z.string().min(32).optional(),
  JWT_ISSUER: z.string().min(1).default('akura-auth'),
  JWT_AUDIENCE: z.string().min(1).default('akura-api'),
}).superRefine((value, context) => {
  if (value.DIRECT_MFE_ACCESS && value.NODE_ENV !== 'development') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['DIRECT_MFE_ACCESS'], message: 'DIRECT_MFE_ACCESS is only allowed when NODE_ENV is development' });
  }
  if (value.NODE_ENV !== 'development') return;
  assertLocalTarget('DATABASE_URL', value.DATABASE_URL, context);
  assertLocalTarget('API_GATEWAY_URL', value.API_GATEWAY_URL, context);
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid Field Service environment variables:', JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const env = result.data;
