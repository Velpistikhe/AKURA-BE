const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const routes = require('../dist/modules/quotations/quotation.routes.js').default;
const env = require('../dist/config/env.js').env;
const { quotationRepository } = require('../dist/modules/quotations/quotation.repository.js');
const { createWorkOrderFromQuotationSchema } = require('../dist/modules/quotations/quotation.schemas.js');

test('Create work order from quotation validates locally and forwards through Field Service', async (t) => {
  const branch = randomUUID(), actor = { id: randomUUID(), name: 'WO Test' };
  const originalFetch = global.fetch, originalFindActive = quotationRepository.findActive;
  t.after(() => { global.fetch = originalFetch; quotationRepository.findActive = originalFindActive; });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.authUser = {
      id: actor.id, firstName: 'WO', lastName: 'Test', username: 'wo', role: 'ADMIN',
      section: req.headers['x-test-section'] || 'MARKETING', officeBranchId: req.headers['x-test-branch'] || branch,
    };
    next();
  });
  app.use('/quotations', routes);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = async (id, body, expected = 201, section, selectedBranch = branch) => {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/quotations/${id}/work-orders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', authorization: 'Bearer user-token',
        ...(section ? { 'x-test-section': section } : {}), 'x-test-branch': selectedBranch,
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json();
    assert.equal(response.status, expected, JSON.stringify(payload));
    return payload;
  };
  const validBody = () => ({ quotationVersion: 0, startDate: '2026-10-01', endDate: '2026-10-05', summary: 'Inspection per quotation', inspectors: ['Budi'] });
  // Repository fixture: findActive is the only database read in this flow.
  quotationRepository.findActive = async (id, officeBranchId) => {
    if (officeBranchId !== branch) assert.fail('Branch must come from the authenticated session');
    if (!rows.has(id)) { const error = new Error('Quotation not found'); error.statusCode = 404; throw error; }
    return rows.get(id);
  };
  const rows = new Map();
  const fixtureQuotation = (changes = {}, id = randomUUID()) => {
    const row = {
      id, officeBranchId: branch, version: 0, status: 'APPROVED', isActive: true,
      items: [], ...changes,
    };
    rows.set(id, row);
    return row;
  };
  let forwarded = null;
  let forwardMode = 'ok';
  let calls = 0;
  try {
    // Schema rejects malformed bodies before any cross-service call.
    for (const invalid of [
      {}, { quotationVersion: 0 }, { quotationVersion: 0, startDate: '2026-10-05', endDate: '2026-10-01', summary: 'x' },
      { ...validBody(), quotationVersion: -1 }, { ...validBody(), status: 'COMPLETED' },
      { ...validBody(), quotationId: randomUUID() }, { ...validBody(), summary: '' },
      { ...validBody(), inspectors: ['same', 'SAME'] },
    ]) assert.equal(createWorkOrderFromQuotationSchema.safeParse(invalid).success, false, JSON.stringify(invalid));
    assert.equal(createWorkOrderFromQuotationSchema.parse(validBody()).startDate, '2026-10-01');

    // Section guard: only Marketing may trigger the forward.
    const protectedQuote = fixtureQuotation({ status: 'APPROVED' });
    assert.equal((await request(protectedQuote.id, validBody(), 403, 'FINANCE')).message, 'Marketing section is required');

    // Quotation must exist in the branch: never a forward for a missing reference.
    const gatewayCalls = () => calls;
    global.fetch = (url, options) => {
      if (String(url).startsWith(env.API_GATEWAY_URL + '/api/v1/')) {
        calls += 1;
        throw new Error('must not be called');
      }
      return originalFetch(url, options);
    };
    assert.equal((await request(randomUUID(), validBody(), 404)).message, 'Quotation not found');
    assert.equal(gatewayCalls(), 0);

    // Fail fast on version/status/pricing without contacting Field Service.
    const stale = fixtureQuotation({ status: 'APPROVED' });
    assert.equal((await request(stale.id, { ...validBody(), quotationVersion: stale.version + 1 }, 409)).message, 'Quotation has changed; reload before creating the Work order');
    const draftQuote = fixtureQuotation({ status: 'CREATED' });
    assert.equal((await request(draftQuote.id, validBody(), 409)).message, 'Work order requires an APPROVED quotation');
    const contractPriced = fixtureQuotation({ status: 'APPROVED', items: [{ priceSelection: { priceSource: 'CONTRACT' } }] });
    assert.equal((await request(contractPriced.id, validBody(), 409)).message, 'Use contract as the work order basis for contract pricing');
    assert.equal(calls, 0);

    // Cross-service forward: token, service credentials and payload are asserted.
    const approved = fixtureQuotation({ status: 'APPROVED' });
    const workOrder = { id: randomUUID(), number: 'WO/2026/000001', status: 'DRAFT', quotationId: approved.id, quotationVersion: approved.version, summary: 'Inspection per quotation' };
    global.fetch = async (url, options) => {
      forwarded = { url: String(url), options };
      if (forwardMode === 'down') throw new Error('offline');
      if (forwardMode === 'upstream-409') return { ok: false, status: 409, json: async () => ({ message: 'Quotation has changed; reload before saving the Work order' }) };
      if (forwardMode === 'upstream-500') return { ok: false, status: 500, json: async () => ({ message: 'Boom' }) };
      return { ok: true, status: 201, json: async () => ({ data: workOrder }) };
    };
    const created = await request(approved.id, validBody());
    assert.equal(created.message, 'Work order created successfully');
    assert.deepEqual(created.data, workOrder);
    assert.match(forwarded.url, /\/api\/v1\/fieldservice\/work-orders$/);
    assert.equal(forwarded.options.method, 'POST');
    assert.equal(forwarded.options.headers.authorization, 'Bearer user-token');
    assert.equal(forwarded.options.headers['x-service-name'], 'marketing-service');
    assert.equal(forwarded.options.headers['x-service-secret'], process.env.GATEWAY_SECRET);
    assert.deepEqual(JSON.parse(forwarded.options.body), {
      quotationId: approved.id, quotationVersion: approved.version,
      startDate: '2026-10-01', endDate: '2026-10-05',
      summary: 'Inspection per quotation', inspectors: ['Budi'],
    });
    assert.equal(JSON.parse(forwarded.options.body).status, undefined, 'status must never be forwarded; Field Service stores DRAFT');
    assert.equal(JSON.parse(forwarded.options.body).officeBranchId, undefined, 'branch must never be client-supplied');

    forwardMode = 'down';
    assert.equal((await request(approved.id, validBody(), 503)).message, 'Field Service is unavailable; retry later');
    forwardMode = 'upstream-409';
    assert.equal((await request(approved.id, validBody(), 409)).message, 'Quotation has changed; reload before saving the Work order');
    forwardMode = 'upstream-500';
    assert.equal((await request(approved.id, validBody(), 502)).message, 'Boom');
    console.log('PASS: quotation work-order creation validates locally, guards section/branch, forwards credentials and payload, and maps upstream failures.');
  } finally {
    global.fetch = originalFetch;
    quotationRepository.findActive = originalFindActive;
    await new Promise(resolve => server.close(resolve));
  }
});
