const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const services = ['api-gateway', 'auth-service', 'app-manager-service', 'marketing-service', 'finance-service', 'fieldservice-service'];
if (!process.argv[2]) {
  for (const service of services) {
    const result = spawnSync(process.execPath, [__filename, service], { stdio: 'inherit' });
    assert.equal(result.status, 0, service);
  }
} else {
  run(process.argv[2]).catch(error => { console.error(error); process.exitCode = 1; });
}

async function run(service) {
  const root = path.resolve(__dirname, '..', service);
  const localRequire = createRequire(path.join(root, 'package.json'));
  localRequire('tsx/cjs');
  if (service === 'api-gateway') {
    const { isLocalOrigin } = localRequire(path.join(root, 'src/utils/localOrigin.ts'));
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:3000', 'https://[::1]:3000']) {
      assert.equal(isLocalOrigin(origin), true);
    }
    for (const origin of ['null', 'file://localhost', 'https://localhost.example.com', 'https://localhost@evil.example', 'not-a-url']) {
      assert.equal(isLocalOrigin(origin), false);
    }
    console.log('api-gateway: local browser origin validation passed');
    return;
  }
  Object.assign(process.env, {
    NODE_ENV: 'development', LOCAL_DIRECT_ACCESS: 'true', VERCEL: '0',
    GATEWAY_SECRET: 'test-gateway', DATABASE_URL: 'postgresql://test:test@localhost/test',
    API_GATEWAY_URL: 'http://localhost:5999', JWT_REFRESH_SECRET: 'test-refresh',
    JWT_ACCESS_PRIVATE_KEY_BASE64: 'test-placeholder',
    AUTH_SERVICE_GATEWAY_SECRET: 'test-auth-destination',
    MARKETING_SERVICE_GATEWAY_SECRET: 'test-marketing-destination',
  });
  const { env } = localRequire(path.join(root, 'src/config/env.ts'));
  const { verifyGatewaySecret } = localRequire(path.join(root, 'src/middlewares/gateway.middleware.ts'));
  function guard(address, headers = {}) {
    let status;
    let passed = false;
    const res = { locals: {}, status(code) { status = code; return this; }, json() {} };
    verifyGatewaySecret({ socket: { remoteAddress: address }, headers }, res, () => { passed = true; });
    return { status, passed, direct: res.locals.localDirectAccess };
  }
  for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(guard(address).passed, true);
  assert.equal(guard('192.168.1.5', { 'x-forwarded-for': '127.0.0.1' }).status, 403);
  assert.equal(guard('192.168.1.5', { 'x-gateway-secret': env.GATEWAY_SECRET }).passed, true);
  env.LOCAL_DIRECT_ACCESS = false;
  assert.equal(guard('127.0.0.1').status, 403);
  env.LOCAL_DIRECT_ACCESS = true;
  for (const mode of ['production', 'test']) {
    env.NODE_ENV = mode;
    assert.equal(guard('127.0.0.1').status, 403);
    assert.equal(guard('127.0.0.1', { 'x-gateway-secret': env.GATEWAY_SECRET }).passed, true);
  }
  env.NODE_ENV = 'development';
  process.env.VERCEL = '1';
  assert.equal(guard('127.0.0.1').status, 403);
  process.env.VERCEL = '0';
  if (service === 'auth-service') { console.log(`${service}: local/production gateway guards passed`); return; }

  const express = localRequire('express');
  const cors = localRequire('cors');
  const { generateKeyPair, exportJWK, SignJWT } = await import(pathToFileURL(localRequire.resolve('jose')).href);
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const key = { ...await exportJWK(publicKey), kid: 'local-test', alg: 'RS256' };
  const profile = { id: 'user-1', role: 'USER', section: 'MARKETING', isActive: true, officeBranchId: 'branch-1' };
  const auth = express();
  auth.use((req, res, next) => {
    if (req.headers['x-gateway-secret'] !== 'test-auth-destination') return res.sendStatus(403);
    next();
  });
  auth.get('/.well-known/jwks.json', (_req, res) => res.json({ keys: [key] }));
  auth.get('/me', (_req, res) => res.json({ data: profile }));
  const authServer = await listen(auth);
  let server;
  try {
    env.AUTH_SERVICE_URL = `http://127.0.0.1:${authServer.address().port}`;
    const { serviceUrl, serviceHeaders } = localRequire(path.join(root, 'src/utils/serviceUrl.ts'));
    assert.equal(serviceUrl('auth/me'), `${env.AUTH_SERVICE_URL}/me`);
    assert.equal(serviceUrl('marketing/quotations'), `${env.MARKETING_SERVICE_URL}/quotations`);
    env.NODE_ENV = 'production';
    assert.equal(serviceUrl('auth/me'), `${env.AUTH_SERVICE_URL}/me`);
    assert.equal(serviceHeaders('auth/me')['x-gateway-secret'], 'test-auth-destination');
    assert.equal(serviceHeaders('marketing/quotations')['x-gateway-secret'], 'test-marketing-destination');
    env.LOCAL_DIRECT_ACCESS = false;
    assert.equal(serviceUrl('auth/me'), `${env.AUTH_SERVICE_URL}/me`);
    env.LOCAL_DIRECT_ACCESS = true;
    env.NODE_ENV = 'development';
    const { verifyAccessToken } = localRequire(path.join(root, 'src/utils/tokens.ts'));
    const token = await new SignJWT({ type: 'access', role: 'USER', officeBranchId: 'branch-1' })
      .setSubject('user-1').setProtectedHeader({ alg: 'RS256', kid: key.kid })
      .setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE).setExpirationTime('5m').sign(privateKey);
    assert.equal((await verifyAccessToken(token)).sub, 'user-1');
    if (['finance-service', 'fieldservice-service'].includes(service)) {
      const marketing = express();
      marketing.get('/reference', (req, res) => {
        assert.equal(req.headers['x-gateway-secret'], 'test-marketing-destination');
        assert.equal(req.headers['x-user-id'], 'user-1');
        assert.equal(req.headers['x-user-role'], 'USER');
        assert.equal(req.headers['x-office-branch-id'], 'branch-1');
        res.json({ data: { id: 'reference-1' } });
      });
      const marketingServer = await listen(marketing);
      try {
        env.MARKETING_SERVICE_URL = `http://127.0.0.1:${marketingServer.address().port}`;
        const { gatewayGet } = localRequire(path.join(root, 'src/integrations/gateway.ts'));
        const result = await gatewayGet('marketing/reference', {
          headers: { authorization: `Bearer ${token}`, 'x-user-id': 'forged' },
          user: await verifyAccessToken(token),
        });
        assert.deepEqual(result, { id: 'reference-1' });
      } finally {
        await new Promise(resolve => marketingServer.close(resolve));
      }
    }
    await assert.rejects(() => verifyAccessToken('invalid-token'));
    const app = express();
    app.use(cors({ origin: true, credentials: true }));
    app.use(verifyGatewaySecret);
    if (service === 'app-manager-service') {
      app.use(localRequire(path.join(root, 'src/middlewares/authorize.middleware.ts')).requireAuthenticated);
    } else {
      app.use(localRequire(path.join(root, 'src/middlewares/auth.middleware.ts')).authenticate);
      if (service === 'marketing-service') {
        const { requireMarketingAccess } = localRequire(path.join(root, 'src/middlewares/authorize.middleware.ts'));
        app.use((req, res, next) => requireMarketingAccess(req, res, next).catch(next));
      }
    }
    app.get('/protected', (_req, res) => res.json({ ok: true }));
    server = await listen(app);
    const url = `http://127.0.0.1:${server.address().port}/protected`;
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { headers: { Authorization: 'Bearer invalid' } })).status, 401);
    const headers = { Authorization: `Bearer ${token}`, 'x-user-id': 'forged-client-value' };
    assert.equal((await fetch(url, { headers })).status, 200);
    if (service === 'marketing-service' || service === 'app-manager-service') {
      profile.isActive = false;
      assert.equal((await fetch(url, { headers })).status, 403);
    }
    console.log(`${service}: guards, routing, signed JWT, CORS and protected HTTP access passed`);
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await new Promise(resolve => authServer.close(resolve));
  }
}

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}
