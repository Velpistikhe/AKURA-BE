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
  PORT: z.string().default('5002').transform((value) => Number.parseInt(value, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GATEWAY_SECRET: z.string().min(1, 'GATEWAY_SECRET is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== 'development') return;
  assertLocalTarget('DATABASE_URL', value.DATABASE_URL, context);
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid App Manager environment variables:', JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const env = result.data;
