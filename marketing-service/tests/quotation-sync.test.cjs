const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

// Runs against the Marketing database (schema pushed by prisma db push) and
// restores the process environment so sibling tests are unaffected.
test('Approved quotation commits its sync outbox atomically and delivers with backoff', async () => {
  const originalFetch = global.fetch;
  const originalTargets = process.env.QUOTATION_SYNC_TARGETS;
  const originalSecret = process.env.QUOTATION_SYNC_SECRET;
  process.env.QUOTATION_SYNC_SECRET = 'test-quotation-sync-secret-with-32-chars!!';
  const modules = ['../dist/config/env.js', '../dist/modules/quotations/quotation-sync.repository.js'];
  for (const module of modules) { try { delete require.cache[require.resolve(module)]; } catch { /* not loaded */ } }
  const { env } = require('../dist/config/env.js');
  process.env.QUOTATION_SYNC_TARGETS = JSON.stringify([{ name: 'fieldservice-service', url: `${env.API_GATEWAY_URL}/api/v1/fieldservice/internal/quotation-snapshots/events` }]);
  delete require.cache[require.resolve('../dist/config/env.js')];
  for (const module of modules) { try { delete require.cache[require.resolve(module)]; } catch { /* not loaded */ } }
  const gatewayUrl = `${env.API_GATEWAY_URL}/api/v1/fieldservice/internal/quotation-snapshots/events`;
  const { prisma } = require('../dist/config/db.js');
  const sync = require('../dist/modules/quotations/quotation-sync.repository.js');
  const branch = randomUUID(), quotationId = randomUUID();
  let fail = false;
  const deliveries = [];
  global.fetch = async (url, options) => {
    assert.equal(String(url), gatewayUrl);
    assert.equal(options.headers['x-service-name'], 'marketing-service');
    assert.equal(options.headers['x-quotation-sync-secret'], 'test-quotation-sync-secret-with-32-chars!!');
    const event = JSON.parse(options.body);
    deliveries.push(event);
    if (fail) return { ok: false, status: 503 };
    return { ok: true, json: async () => ({ success: true, eventId: event.eventId }) };
  };
  try {
    const payload = { id: quotationId, officeBranchId: branch, version: 3, status: 'APPROVED', isActive: true, items: [] };
    const event = await prisma.$transaction(tx => sync.enqueueQuotationSnapshot(tx, {
      id: quotationId, officeBranchId: branch, version: 3, revision: 0, payload, approvedAt: new Date('2026-10-01T00:00:00.000Z'),
    }));
    assert.equal(event.version, 1);
    const job = await prisma.quotationSyncDelivery.findFirst({ where: { eventId: event.id } });
    assert.ok(job, 'delivery row committed with the event');
    assert.equal(job.targetService, 'fieldservice-service');
    assert.equal(job.deliveredAt, null);

    fail = true;
    await sync.deliverQuotationSync(job.id);
    const failed = await prisma.quotationSyncDelivery.findUnique({ where: { id: job.id } });
    assert.equal(failed.deliveredAt, null);
    assert.equal(failed.attempts, 1);
    assert.match(failed.lastError, /HTTP 503/);
    assert.ok(failed.nextRetryAt > new Date(), 'backoff scheduled');
    // Respect backoff: an immediate retry must be a no-op.
    await sync.deliverQuotationSync(job.id);
    assert.equal((await prisma.quotationSyncDelivery.findUnique({ where: { id: job.id } })).attempts, 1);
    assert.equal(deliveries.length, 1);

    fail = false;
    await prisma.quotationSyncDelivery.update({ where: { id: job.id }, data: { nextRetryAt: new Date(0) } });
    await sync.deliverQuotationSync(job.id);
    const done = await prisma.quotationSyncDelivery.findUnique({ where: { id: job.id } });
    assert.ok(done.deliveredAt, 'delivered after recovery');
    assert.equal(done.lastError, null);
    assert.equal(deliveries.length, 2);
    assert.equal(deliveries[1].quotationId, quotationId);
    assert.equal(deliveries[1].quotationVersion, 3);
    assert.deepEqual(deliveries[1].quotation, payload);

    // A second approval publishes version 2 for the same quotation.
    const second = await prisma.$transaction(tx => sync.enqueueQuotationSnapshot(tx, {
      id: quotationId, officeBranchId: branch, version: 4, revision: 1, payload: { ...payload, version: 4 }, approvedAt: new Date(),
    }));
    assert.equal(second.version, 2);
    // Batch processing is bounded and branch scoped.
    const before = deliveries.length;
    await sync.processDueQuotationDeliveries(branch);
    assert.ok(deliveries.length > before, 'due deliveries are attempted');

    // ── Monitoring read: GET /quotations/sync/deliveries listing ──────────────
    const listed = await sync.listQuotationSyncDeliveries({ page: 1, limit: 20 });
    assert.ok(listed.deliveries.length >= 2, 'both events are listed');
    assert.ok(listed.pagination.total >= 2);
    assert.equal(listed.deliveries[0].targetService, 'fieldservice-service');
    assert.equal(listed.deliveries[0].status, 'delivered');
    assert.equal(listed.deliveries[0].event.quotationId, quotationId);
    assert.ok(listed.deliveries[0].deliveredAt instanceof Date);
    assert.equal(listed.deliveries[0].lastError, null);
    const pendingOnly = await sync.listQuotationSyncDeliveries({ page: 1, limit: 20, status: 'pending' });
    assert.ok(pendingOnly.deliveries.every(row => row.deliveredAt === null));
    const filtered = await sync.listQuotationSyncDeliveries({ page: 1, limit: 20, quotationId });
    assert.equal(filtered.pagination.total, listed.deliveries.filter(row => row.event.quotationId === quotationId).length);
    const wrongQuotation = await sync.listQuotationSyncDeliveries({ page: 1, limit: 20, quotationId: randomUUID() });
    assert.equal(wrongQuotation.pagination.total, 0);

    // ── Manual re-dispatch: clears backoff and pushes pending deliveries ──────
    fail = true;
    const third = await prisma.$transaction(tx => sync.enqueueQuotationSnapshot(tx, {
      id: quotationId, officeBranchId: branch, version: 5, revision: 1, payload: { ...payload, version: 5 }, approvedAt: new Date(),
    }));
    const thirdJob = await prisma.quotationSyncDelivery.findFirst({ where: { eventId: third.id } });
    await sync.deliverQuotationSync(thirdJob.id);
    const backedOff = await prisma.quotationSyncDelivery.findUnique({ where: { id: thirdJob.id } });
    assert.equal(backedOff.deliveredAt, null);
    assert.ok(backedOff.nextRetryAt > new Date(), 'failure schedules a backoff');
    fail = false;
    // Immediate deliverQuotationSync is a no-op while backing off...
    await sync.deliverQuotationSync(thirdJob.id);
    assert.equal((await prisma.quotationSyncDelivery.findUnique({ where: { id: thirdJob.id } })).deliveredAt, null);
    // ...but the manual re-dispatch clears the backoff and delivers now.
    const redispatched = await sync.redispatchQuotationSync(branch, quotationId);
    assert.equal(redispatched.retried, 1);
    const redispatchedJob = await prisma.quotationSyncDelivery.findUnique({ where: { id: thirdJob.id } });
    assert.ok(redispatchedJob.deliveredAt, 'manual re-dispatch delivered the pending job');
    assert.equal(redispatchedJob.lastError, null);
    // Other branches are never touched by a manual re-dispatch.
    assert.equal((await sync.redispatchQuotationSync(randomUUID())).retried, 0);
    console.log('PASS: quotation sync outbox commits atomically, retries with backoff, publishes monotonic events, lists for monitoring and re-dispatches manually.');
  } finally {
    global.fetch = originalFetch;
    if (originalTargets === undefined) delete process.env.QUOTATION_SYNC_TARGETS; else process.env.QUOTATION_SYNC_TARGETS = originalTargets;
    if (originalSecret === undefined) delete process.env.QUOTATION_SYNC_SECRET; else process.env.QUOTATION_SYNC_SECRET = originalSecret;
    await prisma.quotationSyncDelivery.deleteMany({ where: { event: { officeBranchId: branch } } });
    await prisma.quotationSyncEvent.deleteMany({ where: { officeBranchId: branch } });
    await prisma.$disconnect();
    for (const module of modules) { try { delete require.cache[require.resolve(module)]; } catch { /* not loaded */ } }
  }
});
