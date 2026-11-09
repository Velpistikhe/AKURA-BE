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
  PORT: z.string().default('5000').transform((value) => Number.parseInt(value, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Hosts this development run may reach besides the local machine. The hosted
  // development environment (the Neon branch and the deployed services) is
  // listed here by name, so an unlisted target is still refused at startup.
  DEV_ALLOWED_REMOTE_HOSTS: z.string().default(''),
  AUTH_SERVICE_GATEWAY_SECRET: z.string().min(1, 'AUTH_SERVICE_GATEWAY_SECRET is required'),
  APP_MANAGER_SERVICE_GATEWAY_SECRET: z.string().min(1, 'APP_MANAGER_SERVICE_GATEWAY_SECRET is required'),
  MARKETING_SERVICE_GATEWAY_SECRET: z.string().min(1, 'MARKETING_SERVICE_GATEWAY_SECRET is required'),
  FINANCE_SERVICE_URL: z.string().url().optional(),
  FINANCE_SERVICE_GATEWAY_SECRET: z.string().min(1).optional(),
  FIELDSERVICE_SERVICE_URL: z.string().url().optional(),
  FIELDSERVICE_SERVICE_GATEWAY_SECRET: z.string().min(1).optional(),
  CORS_ORIGIN: z.string().default('*'),
  AUTH_SERVICE_URL: z.string({ required_error: 'AUTH_SERVICE_URL is required' })
    .url('AUTH_SERVICE_URL must be a valid URL'),
  AUTH_JWKS_URL: z.string({ required_error: 'AUTH_JWKS_URL is required' })
    .url('AUTH_JWKS_URL must be a valid URL'),
  JWT_ISSUER: z.string().min(1).default('akura-auth'),
  JWT_AUDIENCE: z.string().min(1).default('akura-api'),
  APP_MANAGER_SERVICE_URL: z.string({ required_error: 'APP_MANAGER_SERVICE_URL is required' })
    .url('APP_MANAGER_SERVICE_URL must be a valid URL'),
  MARKETING_SERVICE_URL: z.string({ required_error: 'MARKETING_SERVICE_URL is required' })
    .url('MARKETING_SERVICE_URL must be a valid URL'),
  RATE_LIMIT_WINDOW_MS: z.string().default('900000').transform((value) => Number.parseInt(value, 10)),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('100').transform((value) => Number.parseInt(value, 10)),
  AUTH_RATE_LIMIT_WINDOW_MS: z.string().default('900000').transform((value) => Number.parseInt(value, 10)),
  AUTH_RATE_LIMIT_MAX_REQUESTS: z.string().default('10').transform((value) => Number.parseInt(value, 10)),
}).superRefine((value, context) => {
  // Credentials are allowed on every response, so a wildcard origin would let
  // any site read authenticated responses using the victim's cookies. Fail at
  // startup instead of silently exposing the API.
  if (value.NODE_ENV === 'production' && value.CORS_ORIGIN.trim() === '*') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['CORS_ORIGIN'],
      message: 'CORS_ORIGIN must list explicit origins in production; "*" is not allowed because credentials are enabled',
    });
  }
  if (value.CORS_ORIGIN.trim() === '*' && value.NODE_ENV !== 'production') {
    console.warn('[api-gateway] CORS_ORIGIN="*" reflects any origin. Use an explicit origin list outside local development.');
  }
  for (const name of ['FINANCE', 'FIELDSERVICE'] as const) {
    if (Boolean(value[`${name}_SERVICE_URL`]) !== Boolean(value[`${name}_SERVICE_GATEWAY_SECRET`])) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [`${name}_SERVICE_URL`], message: 'Service URL and gateway secret must be configured together' });
    }
  }
  const secrets = [
    value.AUTH_SERVICE_GATEWAY_SECRET,
    value.APP_MANAGER_SERVICE_GATEWAY_SECRET,
    value.MARKETING_SERVICE_GATEWAY_SECRET,
    value.FINANCE_SERVICE_GATEWAY_SECRET,
    value.FIELDSERVICE_SERVICE_GATEWAY_SECRET,
  ].filter((secret): secret is string => secret !== undefined);
  if (new Set(secrets).size !== secrets.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AUTH_SERVICE_GATEWAY_SECRET'],
      message: 'Every downstream service must use a different gateway secret',
    });
  }
  if (value.DEV_ALLOWED_REMOTE_HOSTS && value.NODE_ENV !== 'development') {
    console.warn('[api-gateway] DEV_ALLOWED_REMOTE_HOSTS is ignored outside development.');
  }
  if (value.NODE_ENV !== 'development') return;
  const allowedRemoteHosts = parseAllowedRemoteHosts(value.DEV_ALLOWED_REMOTE_HOSTS);
  // A development gateway must only talk to the local services.
  const targets = {
    AUTH_SERVICE_URL: value.AUTH_SERVICE_URL,
    AUTH_JWKS_URL: value.AUTH_JWKS_URL,
    APP_MANAGER_SERVICE_URL: value.APP_MANAGER_SERVICE_URL,
    MARKETING_SERVICE_URL: value.MARKETING_SERVICE_URL,
    FINANCE_SERVICE_URL: value.FINANCE_SERVICE_URL,
    FIELDSERVICE_SERVICE_URL: value.FIELDSERVICE_SERVICE_URL,
  } as const;
  for (const [label, target] of Object.entries(targets)) {
    if (target) assertAllowedTarget(label, target, context, allowedRemoteHosts);
  }
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid API Gateway environment variables:', JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const env = result.data;
