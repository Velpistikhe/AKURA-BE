import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import helmet from 'helmet';
import { authenticate } from './middlewares/auth.middleware.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { verifyGatewaySecret } from './middlewares/gateway.middleware.js';
import { requestIdMiddleware } from './middlewares/requestId.middleware.js';
import routes from './routes/index.js';
import userSyncEvents from './modules/user-sync/user-sync.routes.js';
import { corsOrigin } from './utils/corsOrigin.js';

const app: Express = express();

app.use(helmet());
app.use(verifyGatewaySecret);
app.use(cors({ origin: corsOrigin, credentials: true, exposedHeaders: ['Content-Disposition'] }));
app.use(requestIdMiddleware);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Internal Auth user sync deliveries; the endpoint requires no user authentication.
app.use(userSyncEvents);

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({
    status: 200,
    success: true,
    message: 'Field Service is healthy',
    data: {
      service: 'fieldservice-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    },
    requestId: req.headers['x-request-id'],
  });
});

app.use(authenticate);
app.use(routes);
// Direct development access calls this service with the gateway-style
// /fieldservice prefix; proxied requests have that prefix removed by gateway.
app.use('/fieldservice', routes);

app.use((req: Request, res: Response) => {
  res.status(404).json({
    status: 404,
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found on Field Service`,
    requestId: req.headers['x-request-id'],
  });
});

app.use(errorHandler);

export default app;
