import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const schema = z.object({
  PORT: z.string().default('5003').transform((value) => Number.parseInt(value, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GATEWAY_SECRET: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  API_GATEWAY_URL: z.string({ required_error: 'API_GATEWAY_URL is required' })
    .url('API_GATEWAY_URL must be a valid URL')
    .transform((value) => value.replace(/\/$/, '')),
  // Development-only opt-in: the local Marketing microfrontend may call this
  // service directly (localhost:5003) without the x-gateway-secret header.
  // JWT, profile, section/role and branch checks remain mandatory on every request.
  DIRECT_MFE_ACCESS: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  DIRECT_MFE_ORIGIN: z.string().url().default('http://localhost:4173'),
  TAX_SYNC_SECRET: z.string().min(32).optional(),
  USER_SYNC_SECRET: z.string().min(32).optional(),
  // Outbox delivery of APPROVED quotation snapshots to Field Service.
  QUOTATION_SYNC_TARGETS: z.string().default('[]').transform((value, ctx) => {
    try { return JSON.parse(value) as unknown; }
    catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected JSON target array' }); return z.NEVER; }
  }).pipe(z.array(z.object({ name: z.string().min(1), url: z.string().url().refine(value => /^https?:\/\//.test(value)) }).strict())
    .refine(rows => new Set(rows.map(row => row.name)).size === rows.length, 'Duplicate target names')),
  QUOTATION_SYNC_SECRET: z.string().min(32).optional(),
  JWT_ISSUER: z.string().min(1).default('akura-auth'),
  JWT_AUDIENCE: z.string().min(1).default('akura-api'),
  AWS_ENDPOINT_URL_S3: z.string().url().optional(),
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_REGION: z.string().min(1).default('us-east-2'),
  AWS_S3_BUCKET: z.string().min(1).default('akura'),
}).superRefine((value, context) => {
  if (value.QUOTATION_SYNC_TARGETS.length && !value.QUOTATION_SYNC_SECRET) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['QUOTATION_SYNC_SECRET'], message: 'QUOTATION_SYNC_SECRET is required for delivery targets' });
  }
  if (value.DIRECT_MFE_ACCESS && value.NODE_ENV !== 'development') {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DIRECT_MFE_ACCESS'],
      message: 'DIRECT_MFE_ACCESS is only allowed when NODE_ENV is development',
    });
  }
});

const result = schema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid Marketing Service environment variables:', JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const env = result.data;
