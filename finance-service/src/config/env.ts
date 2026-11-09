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
  PORT: z.coerce.number().int().min(1).max(65535).default(5004),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  GATEWAY_SECRET: z.string().min(1, 'GATEWAY_SECRET is required'),
  API_GATEWAY_URL: z.string({ required_error: 'API_GATEWAY_URL is required' })
    .url('API_GATEWAY_URL must be a valid URL')
    .transform((value) => value.replace(/\/$/, '')),
  TAX_DELIVERY_TARGETS: z.string().default('[]').transform((value, ctx) => {
    try { return JSON.parse(value) as unknown; }
    catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected JSON target array' }); return z.NEVER; }
  }).pipe(z.array(z.object({ name: z.string().min(1), url: z.string().url().refine(value => /^https?:\/\//.test(value)) }).strict())
    .refine(rows => new Set(rows.map(row => row.name)).size === rows.length, 'Duplicate target names')),
  TAX_SYNC_SECRET: z.string().min(32).optional(),

  JWT_ISSUER: z.string().min(1).default('akura-auth'),
  JWT_AUDIENCE: z.string().min(1).default('akura-api'),
});

const result = envSchema.refine(value => !value.TAX_DELIVERY_TARGETS.length || !!value.TAX_SYNC_SECRET, 'TAX_SYNC_SECRET is required for delivery targets')
  .superRefine((value, context) => {
    if (value.NODE_ENV !== 'development') return;
    assertAllowedTarget('DATABASE_URL', value.DATABASE_URL, context);
    assertAllowedTarget('API_GATEWAY_URL', value.API_GATEWAY_URL, context);
    // Every delivery target must stay local, so a local run can never push a
    // tax event to a deployed service.
    for (const target of value.TAX_DELIVERY_TARGETS) {
      assertAllowedTarget(`TAX_DELIVERY_TARGETS[${target.name}]`, target.url, context);
    }
  })
  .safeParse(process.env);
if (!result.success) {
  console.error('Invalid Finance environment variables:', JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const env = result.data;
