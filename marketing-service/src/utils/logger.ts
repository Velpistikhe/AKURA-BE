import winston from 'winston';
import { env } from '../config/env.js';

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
  defaultMeta: { service: 'marketing-service' },
  transports: [new winston.transports.Console({
    format: winston.format.combine(winston.format.timestamp(), winston.format.colorize(), winston.format.simple()),
  })],
});
