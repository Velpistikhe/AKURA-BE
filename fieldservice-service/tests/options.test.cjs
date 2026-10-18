const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
require('dotenv').config();

process.env.NODE_ENV = 'test';
process.env.DIRECT_MFE_ACCESS = 'false';
process.env.DATABASE_URL ??= 'postgresql://postgres:password@localhost:5432/akura_fieldservice?schema=public';
process.env.GATEWAY_SECRET ??= 'test-service-secret';
process.env.API_GATEWAY_URL ??= 'http://127.0.0.1:1';

const { prisma } = require('../dist/config/db.js');
const { env } = require('../dist/config/env.js');
const routes = require('../dist/routes/index.js').default;
const { errorHandler } = require('../dist/middlewares/error.middleware.js');

test('Inspector and quotation option endpoints are branch scoped and eligibility filtered', async () => {
  const branch = randomUUID(), otherBranch = randomUUID(), user = randomUUID();
  const quotationId = randomUUID();
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (!String(url).startsWith(env.API_GATEWAY_URL + '/api/v1/')) return originalFetch(url, options);
    if (String(url).endsWith('/auth/me')) {
      const token = options.headers.Authorization;
      return { ok: true, json: async () => ({ data: {
        id: user, officeBranchId: token === 'Bearer other' ? otherBranch : branch, isActive: true,
        role: 'USER', section: 'FIELD_SERVICE', firstName: 'Test', lastName: 'User', username: 'test' } }) };
    }
    // Marketing owns eligibility (APPROVED, active, non-contract-priced, branch from the token).
    if (String(url).endsWith('/marketing/quotation-references')) {
      listCalls++;
      if (upstreamFails) throw Error('offline');
      return { ok: true, json: async () => ({ data: { quotations: options.headers.Authorization === 'Bearer other' ? [] : listRows } }) };
    }
    throw new Error(`Unexpected upstream call ${url}`);
  };

  // Rows returned by Marketing's quotation-reference list (already eligibility filtered).
  let listRows = [], listCalls = 0, upstreamFails = false;
  const quotationRow = (id, changes = {}) => ({ id, officeBranchId: branch, no: 1, numberYear: 2026,
    status: 'APPROVED', subject: `Quote ${id}`, customerSnapshot: 'Buyer', companySnapshot: { name: 'Customer' },
    subTotal: '100', taxAmount: '11', total: '111', version: 1, revision: 0, isActive: true,
    createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    approvedAt: '2026-10-01T00:00:00.000Z', ...changes });
  const seedInspector = (id, branchId, patch = {}) => prisma.fieldServiceUser.upsert({
    where: { id }, create: { id, officeBranchId: branchId, user: { id, firstName: 'Budi', lastName: 'Tester',
      username: 'budi', ...patch }, sourceVersion: 1, sourceCreatedAt: new Date(),
      sourceUpdatedAt: new Date() },
    update: { officeBranchId: branchId },
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const other = req.headers.authorization === 'Bearer other';
    req.user = { sub: user, type: 'access', officeBranchId: other ? otherBranch : branch };
    next();
  });
  app.use(routes);
  app.use(errorHandler);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const get = async (path, token = 'valid') => {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: { authorization: 'Bearer ' + token },
    });
    return { status: response.status, body: await response.json() };
  };

  const inspectorId = randomUUID(), foreignId = randomUUID();
  try {
    await seedInspector(inspectorId, branch, { email: 'budi@akura.test', role: 'USER', section: 'FIELD_SERVICE', isActive: true });
    await seedInspector(foreignId, otherBranch);
    listRows = [quotationRow(quotationId)];

    // Options expose the raw Auth user snapshot JSON stored in the read model.
    const inspectors = await get('/options/inspectors');
    assert.equal(inspectors.status, 200);
    assert.deepEqual(inspectors.body.data.inspectors, [
      { id: inspectorId, firstName: 'Budi', lastName: 'Tester', username: 'budi',
        email: 'budi@akura.test', role: 'USER', section: 'FIELD_SERVICE', isActive: true },
    ]);

    // The profile from another branch only sees that branch's rows.
    const foreign = await get('/options/inspectors', 'other');
    assert.equal(foreign.status, 200);
    assert.deepEqual(foreign.body.data.inspectors.map(row => row.id), [foreignId]);

    // Options keep the response shape consumed by the work-order UI, resolved with one live Marketing call.
    const quotations = await get('/options/quotations');
    assert.equal(quotations.status, 200);
    assert.equal(listCalls, 1, 'quotation options use a single live Marketing list call');
    assert.deepEqual(quotations.body.data.quotations, [{
      id: quotationId, number: 1, numberYear: 2026, subject: `Quote ${quotationId}`,
      company: { name: 'Customer' }, quotationVersion: 1, revision: 0,
      approvedAt: '2026-10-01T00:00:00.000Z',
    }], 'response shape is preserved for existing consumers');
    const foreignQuotations = await get('/options/quotations', 'other');
    assert.equal(foreignQuotations.status, 200);
    assert.deepEqual(foreignQuotations.body.data.quotations, [], 'another branch receives no quotation options');
    upstreamFails = true;
    assert.equal((await get('/options/quotations')).status, 503, 'Marketing unavailability returns 503');
    upstreamFails = false;

    // Unauthenticated requests are rejected before any option is read.
    const anonymous = await originalFetch(`http://127.0.0.1:${server.address().port}/options/inspectors`);
    assert.equal(anonymous.status, 401);
    console.log('PASS: option endpoints are branch scoped, eligibility filtered and authenticated.');
  } finally {
    global.fetch = originalFetch;
    await new Promise(resolve => server.close(resolve));
    await prisma.fieldServiceUser.deleteMany({ where: { id: { in: [inspectorId, foreignId] } } });
    await prisma.$disconnect();
  }
});
