import app from './app.js';

import { connectDb, disconnectDb } from './config/db.js';
import { env } from './config/env.js';
import { startQuotationDelivery } from './modules/quotations/quotation-sync.repository.js';
import { logger } from './utils/logger.js';

const start = async (): Promise<void> => {
  try {
    await connectDb();

    const server = app.listen(env.PORT, () => logger.info(`Marketing Service is running on port ${env.PORT}`));
    const stopQuotationSync = startQuotationDelivery();
    const shutdown = (signal: string): void => {
      logger.info(`Received ${signal}; shutting down Marketing Service.`);

      stopQuotationSync();
      server.close(() => void disconnectDb().finally(() => process.exit(0)));
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start Marketing Service', { error });
    process.exit(1);
  }
};
void start();
