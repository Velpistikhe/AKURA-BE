const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { withQuotationFixture } = require('./quotation-fixture.cjs');
const routes = require('../dist/modules/quotations/quotation.routes.js').default;
require('../dist/modules/quotations/work-order.integration.js').hasActiveWorkOrder = async () => false;
withQuotationFixture(async ({ branch, actor, input, prisma }) => {
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { res.locals.authUser = { ...actor, firstName: 'HTTP', lastName: 'Test', officeBranchId: req.headers['x-test-branch'] || branch }; next(); });
  app.use('/quotations', routes);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const request = async (method, path, json, expected, selectedBranch = branch) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json', 'x-test-branch': selectedBranch }, ...(json === undefined ? {} : { body: JSON.stringify(json) }), signal: AbortSignal.timeout(15000) });
    const body = await response.json(); assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(body)}`); return body.data;
  };
  try {
    for (const key of ['staffId', 'deliveryInvoice', 'jobStart', 'items']) { const invalid = { ...input }; delete invalid[key]; await request('POST', '/quotations', invalid, 400); }
    for (const field of ['status', 'invoiceStatus', 'revision', 'no', 'createdById', 'tax']) await request('POST', '/quotations', { ...input, [field]: field === 'status' ? 'APPROVED' : 1 }, 400);
    for (const inquiryMethod of ['email', 'unknown', null, 1]) await request('POST', '/quotations', { ...input, inquiryMethod }, 400);
    for (const items of [[], [{ ...input.items[0], quantityInspection: '-1' }], [{ ...input.items[0], unitPrice: '1' }], [input.items[0], input.items[0]]]) await request('POST', '/quotations', { ...input, items }, 400);
    await request('POST', '/quotations', { ...input, items: [{ ...input.items[0], itemSizeId: randomUUID() }] }, 404);
    assert.equal(await prisma.quotation.count({ where: { officeBranchId: branch } }), 0);
    for (const inquiryMethod of ['EMAIL', 'WHATSAPP', 'VERBAL', 'JOB_ORDER_REQUEST']) {
      const quote = await request('POST', '/quotations', { ...input, inquiryMethod }, 201);
      assert.equal(quote.inquiryMethod, inquiryMethod); assert.equal(quote.status, 'CREATED'); assert.equal(quote.invoiceStatus, null); assert.equal(quote.no, null);
      const path = `/quotations/${quote.id}`;
      await request('GET', path, undefined, 200); await request('GET', path, undefined, 404, randomUUID());
      await request('DELETE', path, { version: quote.version }, 404, randomUUID()); await request('DELETE', path, { version: quote.version + 1 }, 409);
      const removed = await request('DELETE', path, { version: quote.version }, 200);
      assert.equal(removed.isActive, false); assert.equal((await request('GET', path, undefined, 200)).isActive, false);
      await request('DELETE', path, { version: removed.version }, 404); await request('PATCH', path, { version: removed.version, subject: 'Inactive' }, 409);
    }
    for (const query of ['page=-1', 'no=0', 'status=unknown', 'invoiceStatus=unknown', 'dateFrom=2026-10-02&dateTo=2026-10-01']) await request('GET', `/quotations?${query}`, undefined, 400);
    assert.equal((await request('GET', '/quotations?isActive=true', undefined, 200)).pagination.total, 0);
    assert.equal((await request('GET', '/quotations?isActive=false', undefined, 200)).pagination.total, 4);
    await request('GET', '/quotations/invalid', undefined, 400);
    console.log('PASS: quotation HTTP validation, enums, protected fields, duplicate sizes, reference rollback, branch ownership, optimistic concurrency and inactive detail.');
  } finally { await new Promise(resolve => server.close(resolve)); }
}).catch(error => { console.error(error); process.exitCode = 1; });
