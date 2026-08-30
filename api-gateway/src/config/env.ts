import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('5000').transform((value) => Number.parseInt(value, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  GATEWAY_SECRET: z.string().min(1, 'GATEWAY_SECRET is required'),
  CORS_ORIGIN: z.string().default('*'),
  AUTH_SERVICE_URL: z.string().url().default('http://localhost:5001'),
  AUTH_JWKS_URL: z.string().url().default('http://localhost:5001/.well-known/jwks.json'),
  JWT_ISSUER: z.string().min(1).default('akura-auth'),
  JWT_AUDIENCE: z.string().min(1).default('akura-api'),
  APP_MANAGER_SERVICE_URL: z.string().url().default('http://localhost:5002'),
  MARKETING_SERVICE_URL: z.string().url().default('http://localhost:5005'),
  PRODUCT_SERVICE_URL: z.string().url().default('http://localhost:5003'),
  ORDER_SERVICE_URL: z.string().url().default('http://localhost:5004'),
  RATE_LIMIT_WINDOW_MS: z.string().default('900000').transform((value) => Number.parseInt(value, 10)),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('100').transform((value) => Number.parseInt(value, 10)),
});

const result = envSchema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid API Gateway environment variables:', JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}

export const env = result.data;
