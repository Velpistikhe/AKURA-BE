import app from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const server = app.listen(env.PORT, () => {
  logger.info(`API Gateway running on port ${env.PORT} [${env.NODE_ENV}]`);
  logger.info(`Health check: http://localhost:${env.PORT}/health`);
  logger.info(`Registered services: http://localhost:${env.PORT}/services`);
});

const gracefulShutdown = (signal: string): void => {
  logger.info(`Received ${signal}. Gracefully shutting down API Gateway...`);
  server.close(() => {
    logger.info('HTTP server closed.');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forceful shutdown triggered after timeout.');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
