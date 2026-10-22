import { PrismaClient } from '@prisma/client';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export const prisma = new PrismaClient({
  // The validated environment decides the log level, so an unset NODE_ENV
  // cannot silently fall back to development logging in production.
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export const connectDb = async (): Promise<void> => {
  await prisma.$connect();
  logger.info('Connected to the Fieldservice PostgreSQL database.');
};

export const disconnectDb = (): Promise<void> => prisma.$disconnect().catch(() => undefined);
