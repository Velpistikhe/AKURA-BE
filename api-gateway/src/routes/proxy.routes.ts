import { Request, RequestHandler, Response, Router } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { servicesConfig } from '../config/services.config.js';
import { authenticateJwt } from '../middlewares/auth.middleware.js';
import { logger } from '../utils/logger.js';

const router = Router();

servicesConfig.forEach((service) => {
  const middlewares: RequestHandler[] = [];
  if (service.internalCaller) {
    middlewares.push((req, res, next) => {
      if (req.method !== 'POST' || res.locals.serviceCaller !== service.internalCaller) {
        res.status(403).json({ status: 403, success: false, message: `${service.internalCaller} credentials are required`, requestId: req.headers['x-request-id'] });
        return;
      }
      next();
    });
  }
  if (service.authRequired) {
    middlewares.push(authenticateJwt);
  }

  const proxy = createProxyMiddleware<Request, Response>({
    target: service.target,
    changeOrigin: true,
    pathRewrite: service.pathRewrite,
    on: {
      proxyReq: (proxyReq, req) => {
        // Each downstream deployment is a new routing hop. Reusing the
        // incoming Vercel marker can trigger INFINITE_LOOP_DETECTED (508).
        // Keep application tracing in X-Request-ID instead.
        proxyReq.removeHeader('x-vercel-id');
        proxyReq.setHeader('x-gateway-secret', service.gatewaySecret);
        proxyReq.removeHeader('X-User-ID');
        proxyReq.removeHeader('X-User-Role');
        proxyReq.removeHeader('X-User-Name');
        proxyReq.removeHeader('X-User-Email');
        proxyReq.removeHeader('X-User-Username');
        proxyReq.removeHeader('X-Office-Branch-ID');
        proxyReq.removeHeader('X-Service-Name');
        proxyReq.removeHeader('X-Service-Secret');

        const requestId = req.headers['x-request-id'];
        if (requestId) proxyReq.setHeader('X-Request-ID', requestId);
        if (service.authRequired) {
          const userId = req.headers['x-user-id'];
          const userRole = req.headers['x-user-role'];
          const userName = req.headers['x-user-name'];
          const username = req.headers['x-user-username'];
          const officeBranchId = req.headers['x-office-branch-id'];
          if (userId) proxyReq.setHeader('X-User-ID', userId);
          if (userRole) proxyReq.setHeader('X-User-Role', userRole);
          if (userName) proxyReq.setHeader('X-User-Name', userName);
          if (username) proxyReq.setHeader('X-User-Username', username);
          if (officeBranchId) proxyReq.setHeader('X-Office-Branch-ID', officeBranchId);
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
