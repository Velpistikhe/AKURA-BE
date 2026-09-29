import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

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
  // Development-only direct browser access. User requests still require a valid
  // bearer token and live profile/section/branch validation.
  DIRECT_MFE_ACCESS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  DIRECT_MFE_ORIGIN: z.string().url().default('http://localhost:4173'),
  TAX_SYNC_SECRET: z.string().min(32).optional(),

  JWT_ISSUER: z.string().min(1).default('akura-auth'),
  JWT_AUDIENCE: z.string().min(1).default('akura-api'),
});

const result = envSchema.refine(value => !value.TAX_DELIVERY_TARGETS.length || !!value.TAX_SYNC_SECRET, 'TAX_SYNC_SECRET is required for delivery targets')
  .refine(value => !value.DIRECT_MFE_ACCESS || value.NODE_ENV === 'development', { message: 'DIRECT_MFE_ACCESS is only allowed when NODE_ENV is development', path: ['DIRECT_MFE_ACCESS'] })
  .safeParse(process.env);
if (!result.success) {
  console.error('Invalid Finance environment variables:', JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const env = result.data;
