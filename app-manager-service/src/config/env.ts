import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Refuses a development configuration that points at an unintended remote system.
 *
 * Hybrid local runs use the Neon development branch and the deployed API gateway
 * without a per-machine host list: only those hosted targets and local services
 * are approved.
 */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
const DEPLOYED_API_GATEWAY_HOST = 'akura-api-gateway.vercel.app';

const isApprovedDevelopmentHost = (host: string): boolean => {
  const normalized = host.toLowerCase();
  if (LOCAL_HOSTS.includes(normalized)) return true;
  if (normalized.endsWith('.neon.tech')) return true;
  if (normalized === DEPLOYED_API_GATEWAY_HOST) return true;
  return false;
};

const assertAllowedTarget = (
  label: string,
  value: string,
  context: z.RefinementCtx,
): void => {
  let host: string;
  try {
    host = new URL(value.includes('://') ? value : `postgresql://${value}`).hostname;
  } catch {
    return;
  }
  if (!host) return;
  if (isApprovedDevelopmentHost(host)) return;
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `${label} must point at a local host, a Neon development host (*.neon.tech), or ${DEPLOYED_API_GATEWAY_HOST}, but it points at "${host}".`,
  });
};

const envSchema = z.object({
  PORT: z.string().default('5002').transform((value) => Number.parseInt(value, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GATEWAY_SECRET: z.string().min(1, 'GATEWAY_SECRET is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  API_GATEWAY_URL: z.string({ required_error: 'API_GATEWAY_URL is required' })
    .url('API_GATEWAY_URL must be a valid URL')
    .transform((value) => value.replace(/\/$/, '')),
}).superRefine((value, context) => {
  if (value.NODE_ENV !== 'development') return;
  assertAllowedTarget('DATABASE_URL', value.DATABASE_URL, context);
  assertAllowedTarget('API_GATEWAY_URL', value.API_GATEWAY_URL, context);
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid App Manager environment variables:', JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const env = result.data;
