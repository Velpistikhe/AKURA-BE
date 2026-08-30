import { PrismaClient } from '@prisma/client';
import { logger } from '../utils/logger.js';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export const connectDb = async (): Promise<void> => {
  await prisma.$connect();
  logger.info('Connected to the Marketing PostgreSQL database.');
};

export const disconnectDb = (): Promise<void> => prisma.$disconnect().catch(() => undefined);
