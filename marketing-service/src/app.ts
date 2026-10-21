import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Express, Request, Response } from 'express';
import helmet from 'helmet';
import { authenticate } from './middlewares/auth.middleware.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { verifyGatewaySecret } from './middlewares/gateway.middleware.js';
import { requestIdMiddleware } from './middlewares/requestId.middleware.js';
import { corsOrigin } from './utils/corsOrigin.js';
import routes from './routes/index.js';
import taxEvents from './modules/taxes/tax-events.routes.js';
import userSyncEvents from './modules/user-sync/user-sync-events.routes.js';
import workOrderEvents from './modules/quotations/work-order-events.routes.js';

const app: Express = express();
app.use(helmet());
app.use(verifyGatewaySecret);
app.use(cors({ origin: corsOrigin, credentials: true, exposedHeaders: ['Content-Disposition'] }));
app.use(requestIdMiddleware);
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(taxEvents);
app.use(userSyncEvents);
app.use(workOrderEvents);

app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 200, success: true, message: 'Marketing Service is healthy', data: { service: 'marketing-service', timestamp: new Date().toISOString(), uptime: process.uptime() }, requestId: req.headers['x-request-id'] });
});

app.use(authenticate);
app.use(routes);
// The local Marketing microfrontend in direct development access calls this
// service with the gateway-style /marketing prefix (the gateway strips it for
// proxied requests, so both mounts resolve to the same router).
app.use('/marketing', routes);
app.use((req: Request, res: Response) => res.status(404).json({ status: 404, success: false, message: `Route ${req.method} ${req.originalUrl} not found on Marketing Service`, requestId: req.headers['x-request-id'] }));
app.use(errorHandler);
export default app;
