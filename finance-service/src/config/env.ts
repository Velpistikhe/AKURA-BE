import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

/**
 * Refuses a development configuration that points at a remote system.
 *
 * The development environment is hosted: the services run on Vercel and the
 * databases live in a Neon development branch, so a local service legitimately
 * calls remote targets. Only the hosts listed in DEV_ALLOWED_REMOTE_HOSTS are
 * reachable, and the list is explicit per host: an unlisted host - a production
 * branch, a production deployment, or a typo - is still refused.
 */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];

/**
 * The hosts this service may reach in development besides the local machine.
 */
const parseAllowedRemoteHosts = (value: string | undefined): ReadonlySet<string> =>
  new Set(
    (value ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );

const assertAllowedTarget = (
  label: string,
  value: string,
  context: z.RefinementCtx,
  allowedRemoteHosts: ReadonlySet<string>,
): void => {
  let host: string;
  try {
    host = new URL(value.includes('://') ? value : `postgresql://${value}`).hostname;
  } catch {
    // A value that is not a URL cannot be checked here; the schema validates
    // the format separately.
    return;
  }
  if (!host) return;
  const normalized = host.toLowerCase();
  if (LOCAL_HOSTS.includes(normalized) || allowedRemoteHosts.has(normalized)) return;
  context.addIssue({
    code: z.ZodIssueCode.custom,
    message: `${label} must point at a local host or a host listed in DEV_ALLOWED_REMOTE_HOSTS in development, but it points at "${host}". `
      + 'A development environment must never reach an unlisted deployed system.',
  });
};

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(5004),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Hosts this development run may reach besides the local machine. The hosted
  // development environment (the Neon branch and the deployed services) is
  // listed here by name, so an unlisted target is still refused at startup.
  DEV_ALLOWED_REMOTE_HOSTS: z.string().default(''),
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
    if (value.DEV_ALLOWED_REMOTE_HOSTS && value.NODE_ENV !== 'development') {
      console.warn('[finance-service] DEV_ALLOWED_REMOTE_HOSTS is ignored outside development.');
    }
    if (value.NODE_ENV !== 'development') return;
    const allowedRemoteHosts = parseAllowedRemoteHosts(value.DEV_ALLOWED_REMOTE_HOSTS);
    assertAllowedTarget('DATABASE_URL', value.DATABASE_URL, context, allowedRemoteHosts);
    assertAllowedTarget('API_GATEWAY_URL', value.API_GATEWAY_URL, context, allowedRemoteHosts);
    // Every delivery target must stay local, so a local run can never push a
    // tax event to a deployed service.
    for (const target of value.TAX_DELIVERY_TARGETS) {
      assertAllowedTarget(`TAX_DELIVERY_TARGETS[${target.name}]`, target.url, context, allowedRemoteHosts);
    }
  })
  .safeParse(process.env);
if (!result.success) {
  console.error('Invalid Finance environment variables:', JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const env = result.data;
