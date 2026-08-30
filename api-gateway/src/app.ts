import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.config.js';
import { env } from './config/env.js';
import { requestIdMiddleware } from './middlewares/requestId.middleware.js';
import { loggerMiddleware } from './middlewares/logger.middleware.js';
import { globalRateLimiter } from './middlewares/rateLimiter.middleware.js';
import { errorHandler } from './middlewares/error.middleware.js';
import proxyRoutes from './routes/proxy.routes.js';
import { servicesConfig } from './config/services.config.js';

const app: Express = express();

app.use(helmet());
app.use(cors({
  origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN,
  credentials: true,
}));

app.use(requestIdMiddleware);
app.use(loggerMiddleware);
app.use(cookieParser());

app.use(globalRateLimiter);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.get('/api-docs.json', (_req: Request, res: Response) => {
  res.status(200).json(swaggerSpec);
});
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 200,
    success: true,
    message: 'API Gateway is healthy',
    data: {
      service: 'api-gateway',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
    requestId: req.headers['x-request-id'],
  });
});

app.get('/services', (req: Request, res: Response) => {
  res.status(200).json({
    status: 200,
    success: true,
    message: 'Services list retrieved successfully',
    data: servicesConfig.map((s) => ({
      prefix: s.prefix,
      target: s.target,
      authRequired: s.authRequired,
      description: s.description,
    })),
    requestId: req.headers['x-request-id'],
  });
});

app.use(proxyRoutes);
app.use((req: Request, res: Response) => {
  res.status(404).json({
    status: 404,
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found on API Gateway`,
    requestId: req.headers['x-request-id'],
  });
});

app.use(errorHandler);

export default app;
