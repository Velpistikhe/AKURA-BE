import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(5004),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOCAL_DIRECT_ACCESS: z.enum(['true', 'false']).default('true').transform(value => value === 'true'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  GATEWAY_SECRET: z.string().min(1, 'GATEWAY_SECRET is required'),
  AUTH_SERVICE_GATEWAY_SECRET: z.string().min(1),
  MARKETING_SERVICE_GATEWAY_SECRET: z.string().min(1),
  AUTH_SERVICE_URL: z.string().url().default('https://akura-auth-service.vercel.app'),
  MARKETING_SERVICE_URL: z.string().url().default('https://akura-marketing-service.vercel.app'),
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

const result = envSchema.refine(value => !value.TAX_DELIVERY_TARGETS.length || !!value.TAX_SYNC_SECRET, 'TAX_SYNC_SECRET is required for delivery targets').safeParse(process.env);
if (!result.success) {
  console.error('Invalid Finance environment variables:', JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const env = result.data;
