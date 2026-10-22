const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const localRequire = createRequire(path.resolve(__dirname, '../api-gateway/package.json'));
const built = process.argv.includes('--built');
if (!built) localRequire('tsx/cjs');
const express = localRequire('express');
const listen = app => new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });

async function main() {
  const { generateKeyPair, exportJWK, SignJWT } = await import(pathToFileURL(localRequire.resolve('jose')).href);
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...await exportJWK(publicKey), kid: 'gateway-test', alg: 'RS256' };
  const downstream = express();
  let deliveries = 0;
  let workOrderCreations = 0;
  let workOrderRevocations = 0;
  downstream.use((req, res, next) => {
    const secret = req.headers['x-gateway-secret'];
    if (!['auth-secret', 'marketing-secret', 'field-secret'].includes(secret)) return res.sendStatus(403);
    next();
  });
  downstream.use(express.json());
  downstream.get('/.well-known/jwks.json', (_req, res) => res.json({ keys: [jwk] }));
  downstream.post('/work-orders', (req, res) => {
    assert.equal(req.headers['x-gateway-secret'], 'field-secret');
    assert.equal(req.headers['x-service-secret'], undefined);
    assert.equal(req.headers['x-service-name'], undefined);
    assert.equal(req.headers['x-user-id'], 'marketing-actor');
    assert.equal(req.headers['x-office-branch-id'], 'branch-test');
    assert.equal(req.headers['x-request-id'], 'create-work-order');
    assert.equal(req.body.quotationId, 'quotation-test');
    workOrderCreations++;
    res.status(201).json({ data: { id: 'work-order-test', quotationId: req.body.quotationId } });
  });
  downstream.post('/internal/work-orders/events', (req, res) => {
    assert.equal(req.headers['x-gateway-secret'], 'marketing-secret');
    assert.equal(req.headers['x-service-secret'], undefined);
    assert.equal(req.headers['x-service-name'], undefined);
    assert.equal(req.headers['x-user-id'], undefined);
    if (req.headers['x-work-order-sync-secret'] !== 'work-order-secret') return res.sendStatus(403);
    assert.equal(req.body.revoked, true);
    workOrderRevocations++;
    res.json({ success: true, workOrderId: req.body.workOrderId });
  });
  downstream.get('/me', (req, res) => {
    // Simulate a deployment rejecting a reused Vercel routing marker.
    if (req.headers['x-vercel-id']) return res.sendStatus(508);
    assert.equal(req.headers['x-gateway-secret'], 'auth-secret');
    assert.equal(req.headers['x-service-secret'], undefined);
    assert.equal(req.headers.authorization, 'Bearer actor-token');
    assert.equal(req.headers['x-request-id'], 'work-order-request');
    res.json({ data: { id: 'actor' } });
  });
  downstream.post('/internal/taxes/events', (req, res) => {
    assert.equal(req.headers['x-service-secret'], undefined);
    assert.equal(req.headers['x-service-name'], undefined);
    assert.equal(req.headers['x-user-id'], undefined);
    if (req.headers['x-tax-sync-secret'] !== 'tax-secret') return res.sendStatus(403);
    deliveries++;
    res.json({ success: true, eventId: req.body.eventId });
  });
  downstream.post('/internal/users/events', (req, res) => {
    assert.equal(req.headers['x-service-secret'], undefined);
    assert.equal(req.headers['x-service-name'], undefined);
    if (req.headers['x-user-sync-secret'] !== 'sync-secret') return res.sendStatus(403);
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
      JWT_ISSUER: 'akura-auth', JWT_AUDIENCE: 'akura-api',
    });
    const app = localRequire(path.resolve(__dirname, built ? '../api-gateway/dist/app.js' : '../api-gateway/src/app.ts')).default;
    gateway = await listen(app);
    const base = `http://127.0.0.1:${gateway.address().port}`;
    const profile = await fetch(`${base}/api/v1/auth/me`, {
      headers: {
        'x-vercel-id': 'sin1::existing-routing-marker',
        'x-service-name': 'fieldservice-service', 'x-service-secret': 'field-secret',
        authorization: 'Bearer actor-token', 'x-request-id': 'work-order-request',
      },
    });
    assert.equal(profile.status, 200);
    assert.deepEqual(await profile.json(), { data: { id: 'actor' } });
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
    assert(spec.paths['/api/v1/marketing/internal/users/events']);
    assert.equal(spec.paths['/internal/taxes/events'], undefined);
    assert.equal(spec.paths['/api/v1/marketing/internal/taxes/events'].post.servers, undefined);
    assert.equal(spec.paths['/api/v1/marketing/internal/users/events'].post.servers, undefined);
    const userEndpoint = `${base}/api/v1/marketing/internal/users/events`;
    assert.equal((await fetch(userEndpoint, { method: 'POST', headers, body: '{}' })).status, 403);
    const userAccepted = await fetch(userEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-name': 'auth-service', 'x-service-secret': 'auth-secret', 'x-user-sync-secret': 'sync-secret' },
      body: JSON.stringify({ eventId: 'test-user-event' }),
    });
    assert.equal(userAccepted.status, 200);
    assert.deepEqual(await userAccepted.json(), { success: true, eventId: 'test-user-event' });
    assert.equal((await fetch(userEndpoint, { method: 'POST', headers: { ...headers, 'x-service-name': 'finance-service', 'x-service-secret': 'finance-secret' }, body: '{}' })).status, 403);
    // Auth also delivers FIELD_SERVICE user events to Field Service.
    const fieldUserEndpoint = `${base}/api/v1/fieldservice/internal/users/events`;
    assert(spec.paths['/api/v1/fieldservice/internal/users/events']);
    assert.equal(spec.paths['/api/v1/fieldservice/internal/users/events'].post.servers, undefined);
    assert.equal((await fetch(fieldUserEndpoint, { method: 'POST', headers, body: '{}' })).status, 403);
    const fieldAccepted = await fetch(fieldUserEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-service-name': 'auth-service', 'x-service-secret': 'auth-secret', 'x-user-sync-secret': 'sync-secret' },
      body: JSON.stringify({ eventId: 'test-field-user-event' }),
    });
    assert.equal(fieldAccepted.status, 200);
    assert.deepEqual(await fieldAccepted.json(), { success: true, eventId: 'test-field-user-event' });
    assert.equal((await fetch(fieldUserEndpoint, { method: 'POST', headers: { ...headers, 'x-service-name': 'marketing-service', 'x-service-secret': 'marketing-secret' }, body: '{}' })).status, 403);
    // Revoke callbacks must use the Field Service identity and the shared delivery secret.
    const workOrderEndpoint = `${base}/api/v1/marketing/internal/work-orders/events`;
    const workOrderHeaders = { 'content-type': 'application/json', 'x-service-name': 'fieldservice-service', 'x-service-secret': 'field-secret', 'x-work-order-sync-secret': 'work-order-secret' };
    const revoke = supplied => fetch(workOrderEndpoint, {
      method: 'POST', headers: supplied,
      body: JSON.stringify({ workOrderId: 'work-order-test', quotationId: 'quotation-test', revoked: true }),
    });
    assert.equal((await revoke({ 'content-type': 'application/json', 'x-work-order-sync-secret': 'work-order-secret' })).status, 403);
    assert.equal((await revoke({ ...workOrderHeaders, 'x-service-name': 'marketing-service', 'x-service-secret': 'marketing-secret' })).status, 403);
    assert.equal((await revoke({ ...workOrderHeaders, 'x-work-order-sync-secret': 'wrong' })).status, 403);
    assert.equal(workOrderRevocations, 0);
    const revoked = await revoke({ ...workOrderHeaders, 'x-user-id': 'forged' });
    assert.equal(revoked.status, 200);
    assert.deepEqual(await revoked.json(), { success: true, workOrderId: 'work-order-test' });
    assert.equal(workOrderRevocations, 1);

    // Marketing creates Work Orders through the authenticated Field Service gateway route.
    const createHeaders = { 'content-type': 'application/json', 'x-service-name': 'marketing-service', 'x-service-secret': 'marketing-secret', 'x-request-id': 'create-work-order' };
    const create = supplied => fetch(`${base}/api/v1/fieldservice/work-orders`, {
      method: 'POST', headers: supplied, body: JSON.stringify({ quotationId: 'quotation-test' }),
    });
    assert.equal((await create(createHeaders)).status, 401);
    assert.equal(workOrderCreations, 0);
    const token = await new SignJWT({ type: 'access', officeBranchId: 'branch-test', section: 'MARKETING' })
      .setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).setSubject('marketing-actor')
      .setIssuer('akura-auth').setAudience('akura-api').setIssuedAt().setExpirationTime('5m').sign(privateKey);
    const created = await create({ ...createHeaders, authorization: `Bearer ${token}`, 'x-user-id': 'forged' });
    assert.equal(created.status, 201);
    assert.deepEqual(await created.json(), { data: { id: 'work-order-test', quotationId: 'quotation-test' } });
    assert.equal(workOrderCreations, 1);
    console.log('PASS: gateway proxy, Work Order create and revoke routing, service caller restrictions, header replacement, JWT verification and Swagger gateway paths.');
  } finally {
    if (gateway) await new Promise(resolve => gateway.close(resolve));
    await new Promise(resolve => target.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
