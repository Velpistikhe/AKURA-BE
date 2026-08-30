import { env } from './env.js';

interface ServiceRouteConfig {
  prefix: string;
  target: string;
  authRequired: boolean;
  pathRewrite: Record<string, string>;
  description: string;
}

export const servicesConfig: ServiceRouteConfig[] = [
  {
    prefix: '/api/v1/auth',
    target: env.AUTH_SERVICE_URL,
    authRequired: false,
    pathRewrite: { '^/api/v1/auth': '' },
    description: 'Authentication Service',
  },
  {
    prefix: '/api/v1/app-manager',
    target: env.APP_MANAGER_SERVICE_URL,
    authRequired: true,
    pathRewrite: { '^/api/v1/app-manager': '' },
    description: 'App Manager Service',
  },
  {
    prefix: '/api/v1/marketing',
    target: env.MARKETING_SERVICE_URL,
    authRequired: true,
    pathRewrite: { '^/api/v1/marketing': '' },
    description: 'Marketing Service',
  },
  {
    prefix: '/api/v1/products',
    target: env.PRODUCT_SERVICE_URL,
    authRequired: false,
    pathRewrite: { '^/api/v1/products': '' },
    description: 'Product Catalog Service',
  },
  {
    prefix: '/api/v1/orders',
    target: env.ORDER_SERVICE_URL,
    authRequired: true,
    pathRewrite: { '^/api/v1/orders': '' },
    description: 'Order and Checkout Service',
  },
];
