import { env } from './env.js';

interface ServiceRouteConfig {
  prefix: string;
  target: string;
  gatewaySecret: string;
  authRequired: boolean;
  internalCaller?: 'finance-service' | 'auth-service' | 'fieldservice-service';
  pathRewrite: Record<string, string>;
  description: string;
}

export const servicesConfig: ServiceRouteConfig[] = [
  {
    prefix: '/api/v1/marketing/internal/taxes/events',
    target: env.MARKETING_SERVICE_URL,
    gatewaySecret: env.MARKETING_SERVICE_GATEWAY_SECRET,
    authRequired: false,
    internalCaller: 'finance-service',
    // Express removes the entire mounted prefix before invoking the proxy.
    pathRewrite: { '^/': '/internal/taxes/events' },
    description: 'Internal Finance tax delivery to Marketing',
  },
  {
    prefix: '/api/v1/marketing/internal/quotations',
    target: env.MARKETING_SERVICE_URL,
    gatewaySecret: env.MARKETING_SERVICE_GATEWAY_SECRET,
    authRequired: false,
    internalCaller: 'fieldservice-service',
    // Express removes the entire mounted prefix before invoking the proxy, so
    // only the quotation id and the work-order segment are left. They are put
    // back on the internal quotation path (the trailing slash is required so
    // `/uuid/work-order` does not concatenate onto `quotations`).
    pathRewrite: { '^/': '/internal/quotations/' },
    description: 'Internal Field Service Work Order link delivery to Marketing',
  },
  {
    prefix: '/api/v1/auth',
    target: env.AUTH_SERVICE_URL,
    gatewaySecret: env.AUTH_SERVICE_GATEWAY_SECRET,
    authRequired: false,
    pathRewrite: { '^/api/v1/auth': '' },
    description: 'Authentication Service',
  },
  {
    prefix: '/api/v1/app-manager',
    target: env.APP_MANAGER_SERVICE_URL,
    gatewaySecret: env.APP_MANAGER_SERVICE_GATEWAY_SECRET,
    authRequired: true,
    pathRewrite: { '^/api/v1/app-manager': '' },
    description: 'App Manager Service',
  },
  {
    prefix: '/api/v1/marketing',
    target: env.MARKETING_SERVICE_URL,
    gatewaySecret: env.MARKETING_SERVICE_GATEWAY_SECRET,
    authRequired: true,
    pathRewrite: { '^/api/v1/marketing': '' },
    description: 'Marketing Service',
  },
];

if (env.FINANCE_SERVICE_URL && env.FINANCE_SERVICE_GATEWAY_SECRET) {
  servicesConfig.push({
    prefix: '/api/v1/finance', target: env.FINANCE_SERVICE_URL,
    gatewaySecret: env.FINANCE_SERVICE_GATEWAY_SECRET, authRequired: true,
    pathRewrite: { '^/api/v1/finance': '' }, description: 'Finance Service',
  });
}
if (env.FIELDSERVICE_SERVICE_URL && env.FIELDSERVICE_SERVICE_GATEWAY_SECRET) {
  servicesConfig.push({
    prefix: '/api/v1/fieldservice', target: env.FIELDSERVICE_SERVICE_URL,
    gatewaySecret: env.FIELDSERVICE_SERVICE_GATEWAY_SECRET, authRequired: true,
    pathRewrite: { '^/api/v1/fieldservice': '' }, description: 'Field Service Service',
  });
}
