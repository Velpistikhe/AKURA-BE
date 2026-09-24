const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { prisma } = require('../dist/config/db.js');
const routes = require('../dist/modules/quotations/quotation.routes.js').default;

async function main() {
  const branch = randomUUID();
  const actor = randomUUID();
  const app = express();
  app.use(express.json());
  // Exercise the actual quotation router with an injected authenticated context.
  // Gateway/JWT authorization is covered by the service's API verification suite.
  app.use((req, res, next) => {
    res.locals.authUser = { id: actor, firstName: 'HTTP', lastName: 'Test', username: 'test', officeBranchId: req.headers['x-test-branch'] || branch };
    next();
  });
  app.use('/quotations', routes);
  app.use((error, req, res, next) => res.status(error.code === 'P2002' ? 409 : error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let company, service;
  const request = async (method, path, body, officeBranchId = branch) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-test-branch': officeBranchId },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: await res.json() };
  };
  try {
    company = await prisma.company.create({ data: {
      officeBranchId: branch, name: 'HTTP test', normalizeName: branch, type: 'PT', npwp: '0012345678901234', address: 'Jakarta',
      staffs: { create: { name: 'Contact', normalizeName: branch, title: 'mr' } },
    }, include: { staffs: true } });
    service = await prisma.service.create({ data: {
      officeBranchId: branch, name: 'Inspection', type: 'TUBULAR',
      itemCatalog: { create: { officeBranchId: branch, name: 'Pipe', uom: 'JOINT', createdById: actor, createdByName: 'HTTP Test',
        sizes: { create: { size: 'Large', createdById: actor, createdByName: 'HTTP Test' } } } },
    }, include: { itemCatalog: { include: { sizes: true } } } });
    const itemSizeId = service.itemCatalog[0].sizes[0].id;
    const input = {
    jobStart: '2026-10-01',

      date: '2026-09-10', inquiryMethod: 'EMAIL', inquiryDate: '2026-09-10', subject: 'Inspection',
      termOfPayment: '30 days', validity: '30 days', tax: 11, supplyAkura: 'Equipment\nCalibration tools', supplyCustomer: 'Access\nHandling facilities',
      location: 'Jakarta', accomplished: '7 days', deliveryReports: 'PDF', staffId: company.staffs[0].id,
      items: [{ itemSizeId, quantity: '2.500', unitPrice: '100.25' }, { itemSizeId, quantity: '1', unitPrice: '50' }],
    };
    const missingStaff = { ...input }; delete missingStaff.staffId;
    assert.equal((await request('POST', '/quotations', missingStaff)).status, 400);
    for (const invalid of [{ ...input, items: [] }, { ...input, tax: -1 }, { ...input, items: [{ itemSizeId, quantity: '-1', unitPrice: '10' }] }]) {
      assert.equal((await request('POST', '/quotations', invalid)).status, 400);
    }
    const badReference = { ...input, items: [input.items[0], { ...input.items[1], itemSizeId: randomUUID() }] };
    for (const field of ['inquiryMethod', 'status']) {
      for (const value of [1, -1, null, 'unknown', field === 'status' ? 'created' : 'email']) {
        assert.equal((await request('POST', '/quotations', { ...input, [field]: value })).status, 400);
      }
    }
    assert.equal((await request('POST', '/quotations', badReference)).status, 404);
    assert.equal(await prisma.quotation.count({ where: { officeBranchId: branch } }), 0);
    const created = await request('POST', '/quotations', input);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const quote = created.body.data;
    assert.equal(quote.revision, 0);
    assert.equal((await request('POST', '/quotations', { ...input, revision: 9 })).status, 400);
    assert.equal(quote.inquiryMethod, 'EMAIL');
    assert.equal(quote.status, 'CREATED');
    assert.equal(quote.invoiceStatus, null);
    assert.equal(quote.supplyAkura, 'Equipment\nCalibration tools');
    assert.equal(quote.supplyCustomer, 'Access\nHandling facilities');
    assert.equal(Object.hasOwn(quote, 'userId'), false);
    assert.equal((await request('POST', '/quotations', { ...input, userId: actor })).status, 400);
    assert.equal((await request('POST', '/quotations', { ...input, createdById: randomUUID() })).status, 400);
    assert.equal(quote.customerSnapshot, 'Contact');
    assert.equal(quote.no, 1);
    assert.equal(typeof quote.numberYear, 'number');
    assert.equal(quote.items.length, 2);
    assert.equal(quote.total, '333.7');
    assert.equal(quote.createdById, actor);
    assert.equal((await request('POST', '/quotations', { ...input, no: 999 })).status, 400);
    const path = `/quotations/${quote.id}`;
    assert.equal((await request('GET', path)).status, 200);
    assert.equal((await request('GET', path, undefined, randomUUID())).status, 404);
    assert.equal((await request('DELETE', path, { version: 0 }, randomUUID())).status, 404);
    const list = await request('GET', '/quotations?page=1&limit=1');
    assert.deepEqual(list.body.data.quotations.map(q => q.id), [quote.id]);
    assert.equal(list.body.data.pagination.total, 1);
    assert.equal(list.body.data.quotations[0].revision, 0);
    assert.equal((await request('GET', '/quotations?page=-1')).status, 400);
    assert.equal((await request('GET', '/quotations/bad-id')).status, 400);
    assert.equal((await request('DELETE', path, {})).status, 400);
    assert.equal((await request('DELETE', path, { version: 1 })).status, 409);
    const deleted = await request('DELETE', path, { version: 0 });
    assert.equal(deleted.status, 200);
    assert.equal(deleted.body.data.isActive, false);
    assert(deleted.body.data.items.every(row => !row.isActive));
    assert.equal((await request('GET', path)).status, 404);
    assert.equal((await request('GET', '/quotations')).body.data.pagination.total, 0);
    assert.equal((await request('DELETE', path, { version: 1 })).status, 409);
    assert.equal(await prisma.quotationItem.count({ where: { quotationId: quote.id } }), 2);
    assert.equal(await prisma.quotationHistory.count({ where: { quotationId: quote.id } }), 2);
    assert.equal((await request('PATCH', path, { version: 1, subject: 'Inactive' })).status, 409);
    const methods = ['EMAIL', 'WHATSAPP', 'VERBAL', 'JOB_ORDER_REQUEST'];
    const statuses = ['CREATED', 'SENT', 'REJECTED', 'APPROVED', 'REVISED', 'CONFIRMED', 'ON_PROGRESS', 'WORK_ORDER_COMPLETE', 'COMPLETE'];
    for (const [index, status] of statuses.entries()) {
      const inquiryMethod = methods[index % methods.length];
      const result = await request('POST', '/quotations', { ...input, inquiryMethod, status });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      const detail = await request('GET', `/quotations/${result.body.data.id}`);
      assert.equal(detail.body.data.status, status);
      assert.equal(detail.body.data.inquiryMethod, inquiryMethod);
    }
    for (const invoiceStatus of [1, -1, 'created', 'SENT', 'unknown']) {
      assert.equal((await request('POST', '/quotations', { ...input, invoiceStatus })).status, 400);
    }
    for (const invoiceStatus of [null, 'CREATED', 'SEND', 'APPROVED', 'COMPLETE', 'CANCELED', 'EXPIRED']) {
      const result = await request('POST', '/quotations', { ...input, invoiceStatus });
      assert.equal(result.status, 201, JSON.stringify(result.body));
      assert.equal(result.body.data.invoiceStatus, invoiceStatus);
      const detail = await request('GET', `/quotations/${result.body.data.id}`);
      assert.equal(detail.body.data.invoiceStatus, invoiceStatus);
    }
    console.log('PASS: inquiry, quotation and nullable invoice enums, defaults, and invalid enum rejection.');
    console.log('PASS: quotation HTTP create/list/detail/delete, item array, date parsing, totals, validation, rollback, branch isolation, conflicts, and preserved soft-deleted rows/history.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await prisma.quotationHistory.deleteMany({ where: { quotation: { officeBranchId: branch } } });
    await prisma.quotationItem.deleteMany({ where: { quotation: { officeBranchId: branch } } });
    await prisma.quotation.deleteMany({ where: { officeBranchId: branch } });
    await prisma.quotationSequence.deleteMany({ where: { officeBranchId: branch } });
    if (service) await prisma.service.delete({ where: { id: service.id } });
    if (company) await prisma.company.delete({ where: { id: company.id } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
