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
  const quotationId = randomUUID(), contractQuotationId = randomUUID(), oldQuotationId = randomUUID();
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    if (!String(url).startsWith(env.API_GATEWAY_URL + '/api/v1/')) return originalFetch(url, options);
    if (String(url).endsWith('/auth/me')) {
      const token = options.headers.Authorization;
      return { ok: true, json: async () => ({ data: {
        id: user, officeBranchId: token === 'Bearer other' ? otherBranch : branch, isActive: true,
        role: 'USER', section: 'FIELD_SERVICE', firstName: 'Test', lastName: 'User', username: 'test' } }) };
    }
    throw new Error(`Unexpected upstream call ${url}`);
  };

  const quotation = (id, changes = {}) => ({ id, officeBranchId: branch, version: 1, isActive: true,
    no: 1, numberYear: 2026, status: 'APPROVED', subject: `Quote ${id}`,
    companySnapshot: { name: 'Customer' }, customerSnapshot: 'Buyer',
    subTotal: '100', taxAmount: '11', total: '111', items: [], ...changes });
  const seedQuotation = (id, changes = {}) => prisma.quotationSnapshot.upsert({
    where: { officeBranchId_quotationId: { officeBranchId: branch, quotationId: id } },
    create: { officeBranchId: branch, quotationId: id, quotationVersion: 1, payload: quotation(id, changes),
      approvedAt: new Date('2026-10-01T00:00:00.000Z') },
    update: { payload: quotation(id, changes) },
  });
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
    await seedInspector(inspectorId, branch);
    await seedInspector(foreignId, otherBranch);
    await seedQuotation(quotationId);
    await seedQuotation(contractQuotationId, { items: [{ priceSelection: { priceSource: 'CONTRACT' } }] });
    await seedQuotation(oldQuotationId, { status: 'REVISED', isActive: false });

    const inspectors = await get('/options/inspectors');
    assert.equal(inspectors.status, 200);
    assert.deepEqual(inspectors.body.data.inspectors, [{ id: inspectorId, name: 'Budi Tester', username: 'budi' }]);

    // The profile from another branch only sees that branch's rows.
    const foreign = await get('/options/inspectors', 'other');
    assert.equal(foreign.status, 200);
    assert.deepEqual(foreign.body.data.inspectors.map(row => row.id), [foreignId]);

    const quotations = await get('/options/quotations');
    assert.equal(quotations.status, 200);
    assert.deepEqual(quotations.body.data.quotations.map(row => row.id), [quotationId],
      'only active APPROVED non-contract quotations are offered');
    const option = quotations.body.data.quotations[0];
    assert.equal(option.subject, `Quote ${quotationId}`);
    assert.equal(option.number, 1);
    assert.equal(option.quotationVersion, 1);

    // Unauthenticated requests are rejected before any option is read.
    const anonymous = await originalFetch(`http://127.0.0.1:${server.address().port}/options/inspectors`);
    assert.equal(anonymous.status, 401);
    console.log('PASS: option endpoints are branch scoped, eligibility filtered and authenticated.');
  } finally {
    global.fetch = originalFetch;
    await new Promise(resolve => server.close(resolve));
    await prisma.fieldServiceUser.deleteMany({ where: { id: { in: [inspectorId, foreignId] } } });
    await prisma.quotationSnapshot.deleteMany({ where: { quotationId: { in: [quotationId, contractQuotationId, oldQuotationId] } } });
    await prisma.$disconnect();
  }
});
