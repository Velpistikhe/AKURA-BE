import express, { Express, Request, Response } from 'express';
import { readFileSync } from 'node:fs';
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
import { authenticateServiceCaller } from './middlewares/serviceCaller.middleware.js';

const app: Express = express();
const swaggerCss = readFileSync(require.resolve('swagger-ui-dist/swagger-ui.css'), 'utf8');

// Vercel overwrites X-Forwarded-For with the public client IP before invoking
// the Express function. Trust only the direct Vercel proxy hop so req.ip and
// express-rate-limit identify clients correctly without accepting arbitrary
// forwarded chains in local or non-Vercel environments.
if (process.env.VERCEL === '1') {
  app.set('trust proxy', 1);
}

app.use(helmet());
app.use(cors({
  origin: env.CORS_ORIGIN === '*' ? true : env.CORS_ORIGIN,
  credentials: true,
  exposedHeaders: ['Content-Disposition'],
}));

app.use(requestIdMiddleware);
app.use(loggerMiddleware);
app.use(cookieParser());

app.use(authenticateServiceCaller);
app.use(globalRateLimiter);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { customCss: swaggerCss }));
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
