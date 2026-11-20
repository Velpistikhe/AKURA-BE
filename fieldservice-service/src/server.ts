import app from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { env } from './config/env.js';
import { getErrorMessage } from './utils/errorDetails.js';
import { logger } from './utils/logger.js';

const startServer = async (): Promise<void> => {
  try {
    await connectDb();
    const server = app.listen(env.PORT, () => {
      logger.info(`Field Service is running on port ${env.PORT} [${env.NODE_ENV}]`);
      logger.info(`Health check: http://localhost:${env.PORT}/health`);
    });

    const gracefulShutdown = (signal: string): void => {
      logger.info(`Received ${signal}. Gracefully shutting down Field Service...`);
      server.close(() => {
        void disconnectDb().finally(() => process.exit(0));
      });
      setTimeout(() => process.exit(1), 10_000).unref();
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  } catch (error: unknown) {
    logger.error('Failed to start Field Service:', { error: getErrorMessage(error) });
    process.exit(1);
  }
};

void startServer();
