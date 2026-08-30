import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5002').transform((value) => Number.parseInt(value, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GATEWAY_SECRET: z.string().min(1, 'GATEWAY_SECRET is required'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  AUTH_JWKS_URL: z.string({ required_error: 'AUTH_JWKS_URL is required' })
    .url('AUTH_JWKS_URL must be a valid URL'),
  AUTH_SERVICE_URL: z.string({ required_error: 'AUTH_SERVICE_URL is required' })
    .url('AUTH_SERVICE_URL must be a valid URL'),
  JWT_ISSUER: z.string().min(1).default('akura-auth'),
  JWT_AUDIENCE: z.string().min(1).default('akura-api'),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid App Manager environment variables:', JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const env = result.data;
