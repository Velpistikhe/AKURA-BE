const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const localRequire = createRequire(path.resolve(__dirname, '../api-gateway/package.json'));
localRequire('tsx/cjs');
const express = localRequire('express');
const listen = app => new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });

async function main() {
  const downstream = express();
  let deliveries = 0;
  downstream.use((req, res, next) => {
    if (req.headers['x-gateway-secret'] !== 'marketing-secret') return res.sendStatus(403);
    next();
  });
  downstream.use(express.json());
  downstream.post('/internal/taxes/events', (req, res) => {
    assert.equal(req.headers['x-service-secret'], undefined);
    assert.equal(req.headers['x-service-name'], undefined);
    assert.equal(req.headers['x-user-id'], undefined);
    if (req.headers['x-tax-sync-secret'] !== 'tax-secret') return res.sendStatus(403);
    deliveries++;
    res.json({ success: true, eventId: req.body.eventId });
  });
  const target = await listen(downstream);
  let gateway;
  try {
    const targetUrl = `http://127.0.0.1:${target.address().port}`;
    Object.assign(process.env, {
      NODE_ENV: 'test', AUTH_SERVICE_URL: targetUrl, AUTH_JWKS_URL: `${targetUrl}/.well-known/jwks.json`,
      APP_MANAGER_SERVICE_URL: targetUrl, MARKETING_SERVICE_URL: targetUrl,
      FINANCE_SERVICE_URL: targetUrl, FIELDSERVICE_SERVICE_URL: targetUrl,
      AUTH_SERVICE_GATEWAY_SECRET: 'auth-secret', APP_MANAGER_SERVICE_GATEWAY_SECRET: 'app-secret',
      MARKETING_SERVICE_GATEWAY_SECRET: 'marketing-secret', FINANCE_SERVICE_GATEWAY_SECRET: 'finance-secret',
      FIELDSERVICE_SERVICE_GATEWAY_SECRET: 'field-secret', CORS_ORIGIN: 'http://localhost:4173',
    });
    const app = localRequire(path.resolve(__dirname, '../api-gateway/src/app.ts')).default;
    gateway = await listen(app);
    const base = `http://127.0.0.1:${gateway.address().port}`;
    const endpoint = `${base}/api/v1/marketing/internal/taxes/events`;
    const headers = { 'content-type': 'application/json', 'x-service-name': 'finance-service', 'x-service-secret': 'finance-secret', 'x-tax-sync-secret': 'tax-secret' };
    const send = supplied => fetch(endpoint, { method: 'POST', headers: supplied, body: JSON.stringify({ eventId: 'test-event' }) });
    assert.equal((await fetch(`${targetUrl}/internal/taxes/events`, { method: 'POST', headers, body: '{}' })).status, 403);
    assert.equal((await send({ 'content-type': 'application/json', 'x-tax-sync-secret': 'tax-secret' })).status, 403);
    assert.equal((await send({ ...headers, 'x-service-secret': 'wrong' })).status, 403);
    assert.equal((await send({ ...headers, 'x-service-name': 'marketing-service', 'x-service-secret': 'marketing-secret' })).status, 403);
    assert.equal((await send({ ...headers, 'x-tax-sync-secret': 'wrong' })).status, 403);
    assert.equal((await fetch(endpoint, { headers })).status, 403);
    assert.equal(deliveries, 0);
    const accepted = await send({ ...headers, 'x-user-id': 'forged', 'x-gateway-secret': 'forged' });
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { success: true, eventId: 'test-event' });
    assert.equal(deliveries, 1);
    assert.equal((await fetch(`${base}/api/v1/marketing/companies`, { headers })).status, 401);
    const spec = await (await fetch(`${base}/api-docs.json`)).json();
    assert(spec.paths['/api/v1/marketing/internal/taxes/events']);
    assert.equal(spec.paths['/internal/taxes/events'], undefined);
    assert.equal(spec.paths['/api/v1/marketing/internal/taxes/events'].post.servers, undefined);
    console.log('PASS: actual gateway proxy, Finance-only tax delivery, header replacement, JWT requirement and Swagger gateway paths.');
  } finally {
    if (gateway) await new Promise(resolve => gateway.close(resolve));
    await new Promise(resolve => target.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
