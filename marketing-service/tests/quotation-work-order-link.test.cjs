const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
require('dotenv').config();
const routes = require('../dist/modules/quotations/quotation.routes.js').default;
const { quotationRepository } = require('../dist/modules/quotations/quotation.repository.js');

test('Quotation Work Order link state: create stores the reference, revoke clears it and a linked quotation cannot be revised', async (t) => {
  const branch = randomUUID(), actor = { id: randomUUID(), name: 'Link Test' };
  const originalFindActive = quotationRepository.findActive;
  const originalAttach = quotationRepository.attachWorkOrder;
  const originalClear = quotationRepository.clearWorkOrder;
  const originalRevise = quotationRepository.revise;
  const originalDeactivate = quotationRepository.deactivate;
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
    quotationRepository.findActive = originalFindActive;
    quotationRepository.attachWorkOrder = originalAttach;
    quotationRepository.clearWorkOrder = originalClear;
    quotationRepository.revise = originalRevise;
    quotationRepository.deactivate = originalDeactivate;
  });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.authUser = {
      id: actor.id, firstName: 'Link', lastName: 'Test', username: 'link', role: 'ADMIN',
      section: 'MARKETING', officeBranchId: branch,
    };
    next();
  });
  app.use('/quotations', routes);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = async (method, path, body, expected = 200) => {
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/quotations${path}`, {
      method, headers: { 'content-type': 'application/json', authorization: 'Bearer user-token' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json();
    assert.equal(response.status, expected, JSON.stringify(payload));
    return payload;
  };

  const quotationId = randomUUID();
  const workOrderId = randomUUID();
  const workOrder = { id: workOrderId, number: 'WO/2026/000001', status: 'DRAFT', quotationId, officeBranchId: branch, revoked: false, version: 0 };
  const quotation = { id: quotationId, officeBranchId: branch, version: 0, status: 'APPROVED', isActive: true, hasWorkOrder: false, workOrderId: null, items: [] };
  const attachCalls = [];
  const clearCalls = [];

  try {
    quotationRepository.findActive = async (id, officeBranchId) => {
      assert.equal(officeBranchId, branch, 'branch must come from the authenticated session');
      if (id !== quotationId) { const error = new Error('Quotation not found'); error.statusCode = 404; throw error; }
      return quotation;
    };
    quotationRepository.attachWorkOrder = async (id, officeBranchId, order) => {
      attachCalls.push({ id, officeBranchId, order });
      quotation.hasWorkOrder = true;
      quotation.workOrderId = order.id;
      return quotation;
    };
    quotationRepository.clearWorkOrder = async (id, officeBranchId, orderId) => {
      clearCalls.push({ id, officeBranchId, orderId });
      quotation.hasWorkOrder = false;
      quotation.workOrderId = null;
    };
    let reviseCalled = false;
    quotationRepository.revise = async () => { reviseCalled = true; return quotation; };
    let deleteCalls = 0;
    quotationRepository.deactivate = async (id, body, officeBranchId) => {
      assert.equal(id, quotationId);
      assert.equal(body.version, 0);
      assert.equal(officeBranchId, branch);
      deleteCalls += 1;
      return { ...quotation, isActive: false };
    };

    // Field Service is mocked: the quotation link lookup used before a revision.
    let byQuotationCalls = 0;
    global.fetch = async (url) => {
      byQuotationCalls += 1;
      return { ok: true, status: 200, json: async () => ({ data: workOrder }) };
    };

    // A quotation with a live Work Order is rejected before any revision work.
    quotation.hasWorkOrder = true;
    quotation.workOrderId = workOrderId;
    const blocked = await request('POST', `/${quotationId}/revise`, { version: 0 }, 409);
    assert.equal(blocked.message, 'A quotation with an active Work Order cannot be revised until the Work Order is revoked');
    assert.equal(reviseCalled, false, 'the repository must not be reached for a linked quotation');
    const blockedDelete = await request('DELETE', `/${quotationId}`, { version: 0 }, 409);
    assert.match(blockedDelete.message, /cannot be deleted/);
    assert.equal(deleteCalls, 0);
    assert.equal(byQuotationCalls, 0, 'a local link rejects deletion without an upstream call');

    // Without a local link the live Field Service lookup is authoritative.
    quotation.hasWorkOrder = false;
    quotation.workOrderId = null;
    const blockedRemote = await request('POST', `/${quotationId}/revise`, { version: 0 }, 409);
    assert.equal(blockedRemote.message, 'A quotation with an active Work Order cannot be revised until the Work Order is revoked');
    assert.equal(byQuotationCalls, 1, 'the Work Order lookup must be performed');
    assert.equal(reviseCalled, false);
    await request('DELETE', `/${quotationId}`, { version: 0 }, 409);
    assert.equal(deleteCalls, 0, 'a remote Work Order also blocks deletion');

    // Field Service unreachable fails closed: no revision is performed.
    global.fetch = async () => { throw new Error('offline'); };
    const unavailable = await request('POST', `/${quotationId}/revise`, { version: 0 }, 503);
    assert.equal(unavailable.message, 'Field Service is unavailable; retry later');
    assert.equal(reviseCalled, false, 'an unavailable upstream must never allow a revision');
    await request('DELETE', `/${quotationId}`, { version: 0 }, 503);
    assert.equal(deleteCalls, 0, 'an unavailable upstream must never allow deletion');

    // No live Work Order: the revision proceeds.
    global.fetch = async (url) => String(url).includes('/by-quotation/')
      ? { ok: true, status: 200, json: async () => ({ data: null }) }
      : { ok: true, status: 201, json: async () => ({ data: workOrder }) };
    const revised = await request('POST', `/${quotationId}/revise`, { version: 0 }, 201);
    assert.equal(revised.message, 'Quotation revised successfully');
    assert.equal(reviseCalled, true);
    await request('DELETE', `/${quotationId}`, { version: 0 });
    assert.equal(deleteCalls, 1, 'a quotation without a Work Order can be deleted');

    // The create path stores the reference, and the internal revoke event clears it.
    quotation.hasWorkOrder = false;
    quotation.workOrderId = null;
    const created = await request('POST', `/${quotationId}/work-orders`, {
      quotationId, startDate: '2026-10-01', endDate: '2026-10-05', inspectors: [{ userId: randomUUID(), name: 'Budi Inspector' }],
    }, 201);
    assert.equal(created.message, 'Work order created successfully');
    assert.equal(attachCalls.length, 1, 'the Work Order reference must be stored before the response');
    assert.equal(attachCalls[0].order.id, workOrderId);
    assert.equal(attachCalls[0].officeBranchId, branch);

    await clearWorkOrderEvent({ workOrderId, quotationId, officeBranchId: branch, revoked: true, workOrderSnapshot: { number: workOrder.number, status: workOrder.status } });
    assert.equal(clearCalls.length, 1, 'the revoke event must clear the quotation reference');
    assert.equal(clearCalls[0].orderId, workOrderId);
    assert.equal(quotation.hasWorkOrder, false);
    assert.equal(quotation.workOrderId, null);

    console.log('PASS: Work Order link state is stored on create, cleared on revoke, and blocks quotation revisions.');
  } finally {
    global.fetch = originalFetch;
    quotationRepository.findActive = originalFindActive;
    quotationRepository.attachWorkOrder = originalAttach;
    quotationRepository.clearWorkOrder = originalClear;
    quotationRepository.revise = originalRevise;
    quotationRepository.deactivate = originalDeactivate;
    await new Promise(resolve => server.close(resolve));
  }
});

// The internal event handler is exercised directly; the route only wraps it.
async function clearWorkOrderEvent(payload) {
  const { applyWorkOrderSyncEvent } = require('../dist/modules/quotations/work-order-events.routes.js');
  return applyWorkOrderSyncEvent(payload);
}
