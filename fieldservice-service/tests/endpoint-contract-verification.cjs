const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const path = require('node:path');
const express = require('express');
const { openApiDocument, prefix, assertInventory, validate } = require('./swagger-contract.cjs');

async function main() {
  const routes = assertInventory();
  require('dotenv').config();
  const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
  const keys = await generateKeyPair('RS256');
  const key = { ...await exportJWK(keys.publicKey), kid: 'fieldservice-contract-test', alg: 'RS256', use: 'sig' };
  const branch = randomUUID(), otherBranch = randomUUID(), inspectorId = randomUUID(), foreignInspectorId = randomUUID();
  const companyId = randomUUID(), contractId = randomUUID(), quotationId = randomUUID(), itemSizeId = randomUUID();
  const timestamp = new Date().toISOString();
  const profiles = new Map();
  let profileFailure = 0, inspectorFailure = 0, quotationFailure = 0, callbackFailure = 0;
  let inspectorName = 'Contract Inspector', inspectorCalls = 0;
  let optionRows;
  const contract = { id: contractId, version: 0, companyId, contractNumber: 'CONTRACT-TEST', contractDate: '2026-01-01T00:00:00.000Z', effectiveFrom: '2000-01-01T00:00:00.000Z', effectiveUntil: '2099-01-01T00:00:00.000Z', status: 'APPROVED', isDeleted: false, company: { id: companyId, name: 'Contract company', officeBranchId: branch, revoked: false }, prices: [] };
  const quotation = { id: quotationId, officeBranchId: branch, version: 1, isActive: true, no: 1, numberYear: 2026, revision: 0, status: 'APPROVED', date: timestamp, inquiryDate: timestamp, jobStart: '2030-02-01', inquiryMethod: 'EMAIL', subject: 'Contract quotation', termOfPayment: '30 days', validity: '30 days', supplyAkura: 'Tools', supplyCustomer: 'Access', location: 'Jakarta', accomplished: '7 days', deliveryReports: 'PDF', deliveryInvoice: 'Email', staffId: randomUUID(), customerSnapshot: 'Buyer', companySnapshot: { id: companyId, name: 'Contract company' }, subTotal: '100', taxAmount: '11', total: '111', approvedAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
    items: [{ id: randomUUID(), itemSizeId, position: 0, serviceName: 'Inspection', serviceType: 'TUBULAR', itemName: 'Pipe', size: null, note: null, quantityInspection: '1', quantityMaintenance: '0', priceInspection: '100', priceMaintenance: null, subTotal: '100', priceSelection: null, isActive: true, version: 0 }],
  };
  optionRows = [quotation];
  const boundary = express(); boundary.use(express.json());
  boundary.get('/api/v1/auth/.well-known/jwks.json', (_req, res) => res.json({ keys: [key] }));
  boundary.get('/api/v1/auth/me', (req, res) => {
    if (profileFailure) return res.status(profileFailure).json({ message: 'Profile unavailable' });
    const profile = profiles.get(req.headers.authorization?.slice(7));
    res.status(profile ? 200 : 401).json({ data: profile });
  });
  boundary.get('/api/v1/auth/users/field-service/inspectors', (_req, res) => {
    inspectorCalls++;
    if (inspectorFailure) return res.status(inspectorFailure).json({ message: 'Inspectors unavailable' });
    res.json({ data: { inspectors: [{ id: inspectorId, name: inspectorName }] } });
  });
  boundary.get('/api/v1/marketing/contract-references/:id', (req, res) => res.status(req.params.id === contractId ? 200 : 404).json({ data: contract }));
  boundary.get('/api/v1/marketing/quotation-references', (_req, res) => {
    if (quotationFailure) return res.status(quotationFailure).json({ message: 'Quotation unavailable' });
    res.json({ data: { quotations: optionRows } });
  });
  boundary.get('/api/v1/marketing/quotation-references/:id', (req, res) => {
    if (quotationFailure) return res.status(quotationFailure).json({ message: 'Quotation unavailable' });
    res.status(req.params.id === quotationId ? 200 : 404).json({ data: quotation });
  });
  boundary.post('/api/v1/marketing/internal/work-orders/events', (req, res) => {
    if (callbackFailure) return res.status(callbackFailure).json({ message: 'Callback unavailable' });
    res.json({ success: true, workOrderId: req.body.workOrderId, quotationId: req.body.quotationId, revoked: true });
  });
  const listen = app => new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const dependencyServer = await listen(boundary);
  process.env.API_GATEWAY_URL = `http://127.0.0.1:${dependencyServer.address().port}`;
  process.env.DIRECT_MFE_ACCESS = 'false';
  process.env.USER_SYNC_SECRET = randomUUID(); process.env.WORK_ORDER_SYNC_SECRET = randomUUID();
  const { env } = require('../dist/config/env.js');
  const { prisma } = require('../dist/config/db.js');
  require('../dist/utils/logger.js').logger.silent = true;
  const server = await listen(require('../dist/app.js').default);
  const url = `http://127.0.0.1:${server.address().port}`;
  const checks = [], schemaErrors = [], coverage = new Map();
  const identity = async (overrides = {}) => {
    const profile = { id: randomUUID(), username: 'contract', firstName: 'Contract', lastName: 'Actor', role: 'USER', section: 'MARKETING', officeBranchId: branch, isActive: true, ...overrides };
    const token = await new SignJWT({ type: 'access', officeBranchId: profile.officeBranchId, role: profile.role }).setProtectedHeader({ alg: 'RS256', kid: key.kid }).setSubject(profile.id).setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE).setIssuedAt().setExpirationTime('10m').sign(keys.privateKey);
    profiles.set(token, profile); return { token, profile };
  };
  const actor = await identity(), foreign = await identity({ officeBranchId: otherBranch }), field = await identity({ section: 'FIELD_SERVICE' });
  async function request(method, routePath, expected, json, credential = actor, headers = {}) {
    const route = routes.find(item => item.method === method && new RegExp(`^${item.path.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(routePath.split('?')[0]));
    assert.ok(route, `Unknown route ${method} ${routePath}`);
    const response = await fetch(`${url}${routePath}`, { method, headers: { 'x-gateway-secret': env.GATEWAY_SECRET, ...(credential ? { authorization: `Bearer ${credential.token}` } : {}), ...(json === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(json === undefined ? {} : { body: JSON.stringify(json) }), signal: AbortSignal.timeout(20000) });
    const body = await response.json();
    assert.equal(response.status, expected, `${method} ${routePath}: ${JSON.stringify(body)}`);
    const operation = openApiDocument.paths[`${prefix}${route.path}`][method.toLowerCase()];
    const documented = operation.responses[expected];
    if (!documented) schemaErrors.push(`${method} ${route.path}: undocumented ${expected}`);
    if (documented?.content?.['application/json']?.schema) {
      try { validate(body, documented.content['application/json'].schema, `${method} ${route.path} ${expected}`); } catch (error) { schemaErrors.push(error.message); }
    }
    if (expected < 300 && json !== undefined && operation.requestBody?.content?.['application/json']?.schema) {
      try { validate(JSON.parse(JSON.stringify(json)), operation.requestBody.content['application/json'].schema, `${method} ${route.path} request`); } catch (error) { schemaErrors.push(error.message); }
    }
    const operationKey = `${method} ${route.path}`;
    coverage.set(operationKey, [...new Set([...(coverage.get(operationKey) || []), expected])]);
    checks.push({ operation: operationKey, status: expected });
    return body.data ?? body;
  }
  const inspectors = [{ userId: inspectorId, name: inspectorName }];
  const item = { itemSizeId, snapshotItemSize: { itemSizeId, snapShotItem: { name: 'Pipe' }, size: null }, quantityInspection: 1, quantityMaintenance: 0 };
  const input = { contractId, startDate: '2030-01-01', endDate: '2030-01-02', inspectors, items: [item] };
  const sync = async (id, selectedBranch) => {
    const user = { id, username: 'inspector', firstName: selectedBranch === branch ? 'Contract' : 'Foreign', lastName: 'Inspector', email: null, telp: null, role: 'USER', section: 'FIELD_SERVICE', officeBranchId: selectedBranch, isActive: true, version: 1, createdAt: timestamp, updatedAt: timestamp, futureField: 'preserved' };
    return request('POST', '/internal/users/events', 200, { eventId: randomUUID(), officeBranchId: selectedBranch, version: 1, user, futureEventField: true }, null, { 'x-user-sync-secret': env.USER_SYNC_SECRET });
  };
  try {
    assert.equal((await fetch(`${url}/health`)).status, 403);
    for (const route of routes) {
      const routePath = route.path.replace(/\{[^}]+\}/g, 'invalid');
      if (route.path === '/health') await request('GET', routePath, 200, undefined, null);
      else if (route.path.startsWith('/internal/')) {
        await request('POST', routePath, 403, {}, null);
        await request('POST', routePath, 400, {}, null, { 'x-user-sync-secret': env.USER_SYNC_SECRET });
      } else {
        await request(route.method, routePath, 401, undefined, null);
        if (route.path.includes('{') || route.method !== 'GET') await request(route.method, routePath, 400, route.method === 'GET' ? undefined : {});
      }
    }
    await sync(inspectorId, branch); await sync(foreignInspectorId, otherBranch);
    const options = await request('GET', '/options/inspectors', 200);
    assert.deepEqual(options.inspectors.map(row => row.id), [inspectorId]);
    assert.equal(options.inspectors[0].futureField, 'preserved');
    await request('GET', '/options/quotations', 200);
    await request('GET', '/work-orders', 401, undefined, actor, { authorization: 'Bearer invalid' });
    await request('GET', '/work-orders', 200, undefined, null, { cookie: `accessToken=${actor.token}` });
    for (const override of [{ isActive: false }, { officeBranchId: null }, { section: 'FINANCE' }]) await request('GET', '/work-orders', 403, undefined, await identity(override));
    const stale = await identity(); stale.profile.officeBranchId = otherBranch;
    await request('GET', '/work-orders', 401, undefined, stale);
    let order = await request('POST', '/work-orders', 201, input);
    assert.equal(order.status, 'DRAFT'); assert.equal(order.contractSnapshot.contractNumber, contract.contractNumber);
    assert.equal(Object.hasOwn(order.contractSnapshot, 'prices'), false);
    await request('GET', `/work-orders/${order.id}`, 200);
    await request('GET', `/work-orders/${order.id}`, 404, undefined, foreign);
    await request('GET', `/work-orders/${order.id}/history`, 200);
    await request('GET', `/work-orders/${order.id}/history`, 404, undefined, foreign);
    await request('GET', `/work-orders/by-quotation/${quotationId}`, 200);
    await request('GET', '/work-orders?page=0', 400);
    await request('DELETE', `/work-orders/${order.id}`, 403, { version: order.version }, field);
    await request('POST', `/work-orders/${order.id}/start`, 403, { version: order.version }, field);
    order = await request('PATCH', `/work-orders/${order.id}`, 200, { version: order.version, endDate: '2030-01-03' }, field);
    const callsBeforeStaleStart = inspectorCalls;
    await request('POST', `/work-orders/${order.id}/start`, 409, { version: order.version + 1 });
    assert.equal(inspectorCalls, callsBeforeStaleStart);
    await request('PATCH', `/work-orders/${order.id}`, 409, { version: 0, endDate: '2030-01-04' });
    await request('PATCH', `/work-orders/${order.id}`, 400, { version: order.version, status: 'IN_PROGRESS' });
    inspectorName = 'Renamed Inspector';
    await request('POST', `/work-orders/${order.id}/start`, 409, { version: order.version });
    inspectorName = 'Contract Inspector'; inspectorFailure = 503;
    await request('POST', `/work-orders/${order.id}/start`, 503, { version: order.version }); inspectorFailure = 0;
    order = await request('POST', `/work-orders/${order.id}/start`, 200, { version: order.version });
    await request('POST', `/work-orders/${order.id}/start`, 409, { version: order.version });
    await request('DELETE', `/work-orders/${order.id}`, 400, {});
    order = await request('DELETE', `/work-orders/${order.id}`, 200, { version: order.version });
    await request('DELETE', `/work-orders/${order.id}`, 409, { version: order.version });
    await request('GET', '/work-orders?revoked=true', 200);
    await request('GET', `/work-orders/${order.id}`, 200);
    const quoteInput = { ...input, contractId: undefined, quotationId, startDate: '2030-02-01', endDate: '2030-02-02' };
    let quoteOrder = await request('POST', '/work-orders', 201, quoteInput, field);
    assert.equal(Object.hasOwn(quoteOrder.quotationSnapshot, 'total'), false);
    assert.equal(Object.hasOwn(quoteOrder.quotationSnapshot.items[0], 'priceInspection'), false);
    await request('GET', `/work-orders/by-quotation/${quotationId}`, 200);
    await request('GET', `/work-orders/by-quotation/${quotationId}`, 200, undefined, foreign);
    await request('POST', '/work-orders', 409, quoteInput);
    callbackFailure = 503;
    await request('DELETE', `/work-orders/${quoteOrder.id}`, 503, { version: quoteOrder.version }); callbackFailure = 0;
    assert.equal((await prisma.workOrder.findUniqueOrThrow({ where: { id: quoteOrder.id } })).revoked, false);
    quotation.subject = 'Changed quotation';
    await request('POST', `/work-orders/${quoteOrder.id}/start`, 409, { version: quoteOrder.version }); quotation.subject = 'Contract quotation';
    quoteOrder = await request('POST', `/work-orders/${quoteOrder.id}/start`, 200, { version: quoteOrder.version });
    await request('DELETE', `/work-orders/${quoteOrder.id}`, 200, { version: quoteOrder.version });
    profileFailure = 503; await request('GET', '/options/inspectors', 503); profileFailure = 0;
    quotationFailure = 503; await request('GET', '/options/quotations', 503); quotationFailure = 0;
    optionRows = [{ ...quotation, officeBranchId: otherBranch }];
    await request('GET', '/options/quotations', 502); optionRows = [quotation];
    for (const quantityInspection of [0.0001, 1000000000000]) await request('POST', '/work-orders', 400, { ...input, items: [{ ...item, quantityInspection }] });
    assert.equal(coverage.size, routes.length);
    for (const [operation, statuses] of coverage) assert.ok(statuses.some(status => status < 300), `${operation}: missing success`);
    assert.deepEqual(schemaErrors, [], schemaErrors.join('\n'));
    const report = { operations: routes.length, checks: checks.length, externalDependencies: 'Auth JWKS/profile/inspectors and Marketing references/callbacks are local HTTP test doubles; real Field Service HTTP, JWT verification and PostgreSQL', coverage: [...coverage].map(([operation, statuses]) => ({ operation, statuses })) };
    writeFileSync(path.join(__dirname, 'endpoint-contract.last-run.json'), JSON.stringify(report, null, 2));
    console.log(`PASS: ${checks.length} HTTP checks across all ${routes.length} Field Service operations; Swagger, authorization, branch ownership and lifecycle verified.`);
  } finally {
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => dependencyServer.close(resolve))]);
    try {
      const where = { officeBranchId: { in: [branch, otherBranch] } };
      for (const delegate of ['workOrderHistory', 'workOrderItem', 'workOrderInspector']) await prisma[delegate].deleteMany({ where: { workOrder: where } });
      await prisma.workOrder.deleteMany({ where }); await prisma.workOrderSequence.deleteMany({ where });
      await prisma.fieldServiceUser.deleteMany({ where: { id: { in: [inspectorId, foreignInspectorId] } } });
      await prisma.fieldServiceUserSyncRevision.deleteMany({ where: { userId: { in: [inspectorId, foreignInspectorId] } } });
    } finally { await prisma.$disconnect(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
