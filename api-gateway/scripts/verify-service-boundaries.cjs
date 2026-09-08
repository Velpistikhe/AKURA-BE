const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const invokeMiddleware = (middleware, headers) => {
  let nextCalled = false;
  const response = {
    locals: {},
    statusCode: 200,
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
  middleware({ headers }, response, () => { nextCalled = true; });
  return { nextCalled, response };
};

(async () => {
  const [{ env }, { servicesConfig }, { authenticateServiceCaller }] = await Promise.all([
    import('../dist/config/env.js'),
    import('../dist/config/services.config.js'),
    import('../dist/middlewares/serviceCaller.middleware.js'),
  ]);

  assert.equal(new Set(servicesConfig.map(({ gatewaySecret }) => gatewaySecret)).size, servicesConfig.length);
  assert.equal(invokeMiddleware(authenticateServiceCaller, {}).nextCalled, true);
  assert.equal(invokeMiddleware(authenticateServiceCaller, {
    'x-service-name': 'marketing-service',
    'x-service-secret': 'invalid',
  }).response.statusCode, 403);

  for (const [serviceName, serviceSecret] of [
    ['auth-service', env.AUTH_SERVICE_GATEWAY_SECRET],
    ['app-manager-service', env.APP_MANAGER_SERVICE_GATEWAY_SECRET],
    ['marketing-service', env.MARKETING_SERVICE_GATEWAY_SECRET],
  ]) {
    const result = invokeMiddleware(authenticateServiceCaller, {
      'x-service-name': serviceName,
      'x-service-secret': serviceSecret,
    });
    assert.equal(result.nextCalled, true);
    assert.equal(result.response.locals.serviceCaller, serviceName);
  }

  for (const source of [
    '../../app-manager-service/src/config/env.ts',
    '../../marketing-service/src/config/env.ts',
  ]) {
    const contents = readFileSync(resolve(__dirname, source), 'utf8');
    assert.equal(contents.includes('AUTH_SERVICE_URL'), false);
    assert.equal(contents.includes('AUTH_JWKS_URL'), false);
    assert.equal(contents.includes('API_GATEWAY_URL'), true);
  }

  process.stdout.write('Service boundaries verified: gateway-only calls and unique target secrets.\n');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
