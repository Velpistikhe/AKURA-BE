const { test } = require('node:test');
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://postgres:password@localhost:5432/akura_fieldservice?schema=public';
process.env.GATEWAY_SECRET = 'test-service-secret';
process.env.API_GATEWAY_URL = 'http://127.0.0.1:1';
const app = require('../dist/app.js').default;
test('gateway boundary, health envelope and authentication', async () => {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(url + '/health')).status, 403);
    const headers = { 'x-gateway-secret': process.env.GATEWAY_SECRET, 'x-request-id': 'service-smoke-test' };
    const health = await fetch(url + '/health', { headers });
    assert.equal(health.status, 200);
    const payload = await health.json();
    assert.equal(payload.data.service, 'fieldservice-service');
    assert.equal(payload.success, true);
    assert.equal(payload.requestId, 'service-smoke-test');
    assert.equal((await fetch(url + '/private', { headers })).status, 401);
    assert.equal((await fetch(url + '/private', { headers: { ...headers, authorization: 'Bearer invalid' } })).status, 401);
    assert.equal((await fetch(url + '/private', { headers: { ...headers, 'x-user-id': 'spoofed' } })).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
