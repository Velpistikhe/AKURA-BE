const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { serviceRepository } = require('../dist/modules/services/service.repository.js');
const routes = require('../dist/modules/services/service.routes.js').default;
const { createServiceSchema } = require('../dist/modules/services/service.schemas.js');

async function main() {
  const serviceId = randomUUID(), inspectionScopeId = randomUUID(), officeBranchId = randomUUID();
  const row = { id: inspectionScopeId, serviceId, inspectionScope: 'Visual inspection', revoked: false };
  let existing = null, active = true;
  const calls = [];
  serviceRepository.findById = async () => ({ id: serviceId, officeBranchId, inspectionScopes: [row], maintenanceScopes: [], isActive: active });
  serviceRepository.findInspectionScopeByName = async (...args) => { calls.push(args); return existing; };
  serviceRepository.createInspectionScope = async (...args) => { calls.push(args); return active ? row : null; };
  serviceRepository.revokeInspectionScope = async (...args) => { calls.push(args); return { ...row, revoked: true }; };
  serviceRepository.findActiveById = async () => ({ id: serviceId, officeBranchId, inspectionScopes: [row], maintenanceScopes: [], isActive: active });
  const base = { name: 'Inspection', type: 'TUBULAR', hasMaintenance: false };
  assert.deepEqual(createServiceSchema.parse({ ...base, inspectionScopes: ['Visual inspection'] }).inspectionScopes, ['Visual inspection']);
  assert.equal(createServiceSchema.safeParse({ ...base, scopes: ['Legacy'] }).success, false);
  assert.equal(createServiceSchema.safeParse({ ...base, inspectionScopes: ['Same', 'Same'] }).success, false);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.authUser = { id: randomUUID(), firstName: 'Test', lastName: 'User', officeBranchId };
    next();
  });
  app.use('/services', routes);
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const request = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/services/${serviceId}${path}`, {
      method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, text: await response.text() };
  };
  try {
    const created = await request('POST', '/inspection/scopes', { inspectionScope: '  Visual inspection  ' });
    assert.equal(created.status, 201, created.text);
    assert.deepEqual(JSON.parse(created.text).data, row);
    assert.equal(JSON.parse(created.text).message, 'Inspection scope created successfully');
    assert.deepEqual(calls[0], [serviceId, 'Visual inspection', officeBranchId]);
    assert.deepEqual(calls[1].slice(0, 3), [serviceId, 'Visual inspection', officeBranchId]);
    assert.equal((await request('POST', '/inspection/scopes', { scope: 'Legacy' })).status, 400);
    assert.equal((await request('POST', '/scopes', { inspectionScope: 'Legacy' })).status, 404);
    existing = row;
    assert.equal((await request('POST', '/inspection/scopes', { inspectionScope: row.inspectionScope })).status, 409);
    existing = { ...row, revoked: true };
    assert.equal((await request('POST', '/inspection/scopes', { inspectionScope: row.inspectionScope })).status, 201);
    const detail = JSON.parse((await request('GET', '')).text).data;
    assert.deepEqual(detail.inspectionScopes, [row]);
    assert.equal(Object.hasOwn(detail, 'scopes'), false);
    const removed = await request('DELETE', `/inspection/scopes/${inspectionScopeId}`);
    assert.equal(removed.status, 200, removed.text);
    assert.equal(JSON.parse(removed.text).data.revoked, true);
    assert.deepEqual(calls.at(-1).slice(0, 3), [serviceId, inspectionScopeId, officeBranchId]);
    assert.equal((await request('DELETE', '/inspection/scopes/invalid')).status, 400);
    active = false;
    assert.equal((await request('DELETE', `/inspection/scopes/${inspectionScopeId}`)).status, 409);
    assert.equal((await request('POST', '/inspection/scopes', { inspectionScope: row.inspectionScope })).status, 409);
    console.log('Inspection scope validation, HTTP contract, and business logic checks passed (mock repository).');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
