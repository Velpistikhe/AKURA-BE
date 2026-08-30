import { Request, RequestHandler, Response, Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { env } from '../config/env.js';
import { servicesConfig } from '../config/services.config.js';
import { authenticateJwt } from '../middlewares/auth.middleware.js';
import { logger } from '../utils/logger.js';

const router = Router();

servicesConfig.forEach((service) => {
  const middlewares: RequestHandler[] = [];
  if (service.authRequired) {
    middlewares.push(authenticateJwt);
  }

  const proxy = createProxyMiddleware<Request, Response>({
    target: service.target,
    changeOrigin: true,
    pathRewrite: service.pathRewrite,
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader('x-gateway-secret', env.GATEWAY_SECRET);
        proxyReq.removeHeader('X-User-ID');
        proxyReq.removeHeader('X-User-Role');
        proxyReq.removeHeader('X-User-Email');
        proxyReq.removeHeader('X-User-Username');

        const requestId = req.headers['x-request-id'];
        if (requestId) proxyReq.setHeader('X-Request-ID', requestId);
        if (service.authRequired) {
          const userId = req.headers['x-user-id'];
          const userRole = req.headers['x-user-role'];
          const username = req.headers['x-user-username'];
          if (userId) proxyReq.setHeader('X-User-ID', userId);
          if (userRole) proxyReq.setHeader('X-User-Role', userRole);
          if (username) proxyReq.setHeader('X-User-Username', username);
        }
      },
      error: (error, req, res) => {
        logger.error(`Proxy Error [${service.prefix} -> ${service.target}]: ${error.message}`, {
          requestId: req.headers['x-request-id'],
        });
        if ('headersSent' in res && !res.headersSent && 'status' in res && typeof res.status === 'function') {
          res.status(503).json({
            status: 503,
            success: false,
            message: `Service Unavailable: Unable to reach target service for ${service.prefix}`,
            requestId: req.headers['x-request-id'],
          });
        }
      },
    },
  });

  middlewares.push(proxy);
  router.use(service.prefix, ...middlewares);
  logger.info(
    `Registered proxy route: ${service.prefix} -> ${service.target} (Auth: ${service.authRequired ? 'YES' : 'NO'})`
  );
});

export default router;
