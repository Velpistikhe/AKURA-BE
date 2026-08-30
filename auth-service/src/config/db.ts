import { PrismaClient } from '@prisma/client';
import { getErrorMessage } from '../utils/errorDetails.js';
import { logger } from '../utils/logger.js';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export const connectDb = async (): Promise<void> => {
  try {
    await prisma.$connect();
    logger.info('Prisma Client connected to PostgreSQL database.');
  } catch (error: unknown) {
    logger.error('Failed to connect to PostgreSQL via Prisma:', { error: getErrorMessage(error) });
    throw error;
  }
};

export const disconnectDb = (): Promise<void> => prisma.$disconnect().catch(() => undefined);
