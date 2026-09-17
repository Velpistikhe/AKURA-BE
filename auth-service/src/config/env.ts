import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5001').transform((value) => Number.parseInt(value, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOCAL_DIRECT_ACCESS: z.enum(['true', 'false']).default('true').transform(value => value === 'true'),
  GATEWAY_SECRET: z.string().min(1, 'GATEWAY_SECRET is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_ACCESS_PRIVATE_KEY_PATH: z.string().min(1).optional(),
  JWT_ACCESS_PRIVATE_KEY_BASE64: z.string().min(1).optional(),
  JWT_ACCESS_KEY_ID: z.string().min(1).default('akura-access-key-1'),
  JWT_ISSUER: z.string().min(1).default('akura-auth'),
  JWT_AUDIENCE: z.string().min(1).default('akura-api'),
  JWT_ACCESS_EXPIRES_IN: z.string().regex(/^\d+(ms|s|m|h|d)$/).default('15m'),
  JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
  JWT_REFRESH_EXPIRES_IN: z.string().regex(/^\d+(ms|s|m|h|d)$/).default('7d'),
  JWT_REFRESH_IDLE_TIMEOUT_MINUTES: z.string().regex(/^[1-9]\d*$/).default('60')
    .transform((value) => Number.parseInt(value, 10)),
}).refine(
  (value) => Boolean(value.JWT_ACCESS_PRIVATE_KEY_PATH || value.JWT_ACCESS_PRIVATE_KEY_BASE64),
  { message: 'JWT_ACCESS_PRIVATE_KEY_PATH or JWT_ACCESS_PRIVATE_KEY_BASE64 is required' }
);

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid Auth Service environment variables:', JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const env = result.data;
