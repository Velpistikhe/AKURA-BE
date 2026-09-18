import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';

import { requestIdMiddleware } from './middlewares/requestId.middleware.js';
import { verifyGatewaySecret } from './middlewares/gateway.middleware.js';
import { errorHandler } from './middlewares/error.middleware.js';
import authRoutes from './modules/auth/auth.routes.js';
import { accessTokenJwks } from './config/accessKey.js';
import userManagementRoutes from './modules/user-management/user-management.routes.js';

const app: Express = express();

app.use(helmet());
app.use(verifyGatewaySecret);
app.use(cors({
  origin: true,
  credentials: true,
}));

app.use(requestIdMiddleware);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 200,
    success: true,
    message: 'Auth Service is healthy',
    data: {
      service: 'auth-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
    requestId: req.headers['x-request-id'],
  });
});

app.get('/.well-known/jwks.json', (_req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json(accessTokenJwks);
});

app.use('/users', userManagementRoutes);
app.use('/', authRoutes);
app.use((req: Request, res: Response) => {
  res.status(404).json({
    status: 404,
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found on Auth Service`,
    requestId: req.headers['x-request-id'],
  });
});

app.use(errorHandler);

export default app;
