const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const routes = require('../dist/modules/quotations/quotation.routes.js').default;
const env = require('../dist/config/env.js').env;
const { quotationRepository } = require('../dist/modules/quotations/quotation.repository.js');

test('Create invoice from quotation forwards the quotation reference to Finance', async (t) => {
  const branch = randomUUID(), actor = { id: randomUUID(), name: 'Finance Test' };
  const itemSizeId = randomUUID();
  const originalFetch = global.fetch, originalFindActive = quotationRepository.findActive;
  t.after(() => { global.fetch = originalFetch; quotationRepository.findActive = originalFindActive; });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.authUser = { id: actor.id, firstName: 'Fin', lastName: 'Test', username: 'fin', role: 'USER', section: req.headers['x-test-section'] || 'MARKETING', officeBranchId: req.headers['x-test-branch'] || branch };
    next();
  });
  app.use('/quotations', routes);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = async (id, body, expected = 201, section, selectedBranch = branch) => {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/quotations/${id}/invoices`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer user-token', ...(section ? { 'x-test-section': section } : {}), 'x-test-branch': selectedBranch }, body: JSON.stringify({quotationId:id,location:'Jakarta',purchaseOrderNumber:'PO/2026/000001',purchaseOrderDate:'2026-01-15',...body}) });
    const payload = await response.json(); assert.equal(response.status, expected, JSON.stringify(payload)); return payload;
  };
  const rows = new Map();
  const quotation = {
    id: randomUUID(), officeBranchId: branch, version: 3, status: 'APPROVED', isActive: true, subject: 'Inspection',
    subTotal: '100.00', taxAmount: '12.00', total: '112.00',
    items: [{ id: randomUUID(), itemSizeId, position: 0, itemName: 'Tank', serviceName: 'Inspection', serviceType: 'INSPECTION', size: 'L', note: null, quantityInspection: '2', quantityMaintenance: '1', priceInspection: '30.00', priceMaintenance: '40.00', discount: '0', subTotal: '100.00' }],
  };
  quotationRepository.findActive = async (id, officeBranchId) => {
    if (officeBranchId !== branch) assert.fail('Branch must come from the authenticated session');
    if (!rows.has(id)) { const error = new Error('Quotation not found'); error.statusCode = 404; throw error; }
    return rows.get(id);
  };
  rows.set(quotation.id, quotation);
  let forwarded = null, workOrder = null;
  try {
    assert.equal((await request(quotation.id, { kind: 'RECEIPT' }, 400)).message, 'Validation failed');
    assert.equal((await request(quotation.id, { kind: 'INVOICE', dueDate: 'not-a-date' }, 400)).message, 'Validation failed');
    assert.equal((await request(quotation.id, { kind: 'INVOICE', dueDate: '2099-12-31' }, 403, 'FINANCE')).message, 'Marketing section is required');
    await request(quotation.id, { kind: 'INVOICE' }, 400);
    await request(quotation.id, { kind: 'INVOICE', dueDate: null }, 400);
    // Every invoice creation must carry the purchase order number and date.
    await request(quotation.id, { kind: 'INVOICE', dueDate: '2099-12-31', purchaseOrderNumber: undefined, purchaseOrderDate: undefined }, 400);
    await request(quotation.id, { kind: 'INVOICE', dueDate: '2099-12-31', purchaseOrderNumber: '', purchaseOrderDate: '2026-01-15' }, 400);
    await request(quotation.id, { kind: 'INVOICE', dueDate: '2099-12-31', purchaseOrderNumber: 'PO/2026/000001', purchaseOrderDate: 'not-a-date' }, 400);
    quotation.status = 'CREATED';
    assert.equal((await request(quotation.id, { kind: 'INVOICE', dueDate: '2099-12-31' }, 409)).message, 'Invoice requires an APPROVED quotation');
    quotation.status = 'APPROVED';
    global.fetch = async (url, options) => { if(String(url).includes('/fieldservice/')) return {ok:true,json:async()=>({data:workOrder})}; forwarded = { url: String(url), options }; return { ok: true, status: 201, json: async () => ({ data: { id: randomUUID(), number: 'INV/2026/000001', status: 'DRAFT' } }) }; };
    const created = await request(quotation.id, { kind: 'INVOICE', dueDate: '2026-12-31', location: 'Jakarta', purchaseOrderNumber:'PO/2026/000001', purchaseOrderDate:'2026-01-15' });
    assert.equal(created.message, 'Draft finance document created successfully');
    assert.equal(forwarded.url, `${env.API_GATEWAY_URL}/api/v1/finance/documents/from-marketing`);
    assert.equal(forwarded.options.headers.authorization, 'Bearer user-token');
    const payload = JSON.parse(forwarded.options.body);
    assert.deepEqual(payload,{quotationId:quotation.id,kind:'INVOICE',dueDate:'2026-12-31',location:'Jakarta',purchaseOrderNumber:'PO/2026/000001',purchaseOrderDate:'2026-01-15'});
    global.fetch = async (url, options) => { if(String(url).includes('/fieldservice/')) return {ok:true,json:async()=>({data:workOrder})}; forwarded = { url: String(url), options }; return { ok: true, status: 201, json: async () => ({ data: { id: randomUUID(), number: 'PI/2026/000001', status: 'DRAFT' } }) }; };
    await request(quotation.id, { kind: 'PROFORMA_INVOICE', dueDate: '2099-12-31', purchaseOrderNumber:'PO/2026/000001', purchaseOrderDate:'2026-01-15' });
    assert.equal(forwarded.url, `${env.API_GATEWAY_URL}/api/v1/finance/documents/from-marketing`);
    workOrder={id:randomUUID(),quotationId:quotation.id,officeBranchId:branch,revoked:false,status:'IN_PROGRESS'};
    await request(quotation.id,{kind:'INVOICE',dueDate:'2099-12-31'},409);
    workOrder.status='COMPLETED';
    await request(quotation.id,{kind:'INVOICE',dueDate:'2099-12-31'});
    await request(quotation.id,{quotationId:randomUUID(),kind:'INVOICE',dueDate:'2099-12-31'},400);
    quotation.officeBranchId=randomUUID();await request(quotation.id,{kind:'INVOICE',dueDate:'2099-12-31'},404);quotation.officeBranchId=branch;
    workOrder=null;
    global.fetch = async (url) => { if(String(url).includes('/fieldservice/'))return {ok:true,json:async()=>({data:null})}; throw Error('offline'); };
    assert.equal((await request(quotation.id, { kind: 'INVOICE', dueDate: '2099-12-31' }, 503)).message, 'Finance Service is unavailable; retry later');
    console.log('PASS: quotation invoice creation forwards the quotation reference to Finance and maps upstream failures.');
  } finally {
    global.fetch = originalFetch; quotationRepository.findActive = originalFindActive;
    await new Promise(resolve => server.close(resolve));
  }
});
