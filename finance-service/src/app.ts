import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import helmet from 'helmet';
import { authenticate } from './middlewares/auth.middleware.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { verifyGatewaySecret } from './middlewares/gateway.middleware.js';
import { requestIdMiddleware } from './middlewares/requestId.middleware.js';
import routes from './routes/index.js';

const app: Express = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(requestIdMiddleware);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(verifyGatewaySecret);

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 200,
    success: true,
    message: 'Finance Service is healthy',
    data: {
      service: 'finance-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
    requestId: req.headers['x-request-id'],
  });
});

app.use(authenticate);
app.use(routes);

app.use((req: Request, res: Response) => {
  res.status(404).json({
    status: 404,
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found on Finance Service`,
    requestId: req.headers['x-request-id'],
  });
});

app.use(errorHandler);

export default app;
