import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

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
  JWT_ISSUER: z.string().min(1).default('akura-auth'),
  JWT_AUDIENCE: z.string().min(1).default('akura-api'),
}).superRefine((value, context) => {
  if (value.DIRECT_MFE_ACCESS && value.NODE_ENV !== 'development') {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['DIRECT_MFE_ACCESS'], message: 'DIRECT_MFE_ACCESS is only allowed when NODE_ENV is development' });
  }
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid Field Service environment variables:', JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const env = result.data;
