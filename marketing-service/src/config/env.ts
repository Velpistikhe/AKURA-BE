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

const schema = z.object({
  PORT: z.string().default('5003').transform((value) => Number.parseInt(value, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GATEWAY_SECRET: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  API_GATEWAY_URL: z.string({ required_error: 'API_GATEWAY_URL is required' })
    .url('API_GATEWAY_URL must be a valid URL')
    .transform((value) => value.replace(/\/$/, '')),
  // Hosts this development run may reach besides the local machine. The hosted
  // development environment (the Neon branch and the deployed services) is
  // listed here by name, so an unlisted target is still refused at startup.
  DEV_ALLOWED_REMOTE_HOSTS: z.string().default(''),
  TAX_SYNC_SECRET: z.string().min(32).optional(),
  WORK_ORDER_SYNC_SECRET: z.string().min(32).optional(),
  JWT_ISSUER: z.string().min(1).default('akura-auth'),
  JWT_AUDIENCE: z.string().min(1).default('akura-api'),
  AWS_ENDPOINT_URL_S3: z.string().url().optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).default('us-east-2'),
  AWS_S3_BUCKET: z.string().min(1).default('akura'),
}).superRefine((value, context) => {
  if (value.DEV_ALLOWED_REMOTE_HOSTS && value.NODE_ENV !== 'development') {
    console.warn('[marketing-service] DEV_ALLOWED_REMOTE_HOSTS is ignored outside development.');
  }
  if (value.NODE_ENV !== 'development') return;
  const allowedRemoteHosts = parseAllowedRemoteHosts(value.DEV_ALLOWED_REMOTE_HOSTS);
  assertAllowedTarget('DATABASE_URL', value.DATABASE_URL, context, allowedRemoteHosts);
  assertAllowedTarget('API_GATEWAY_URL', value.API_GATEWAY_URL, context, allowedRemoteHosts);
  if (value.AWS_ENDPOINT_URL_S3) assertAllowedTarget('AWS_ENDPOINT_URL_S3', value.AWS_ENDPOINT_URL_S3, context, allowedRemoteHosts);
});

const result = schema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid Marketing Service environment variables:', JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const env = result.data;
