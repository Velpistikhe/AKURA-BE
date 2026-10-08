const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { withUserSyncDatabase } = require('./user-sync-fixture.cjs');
const snapshot = (branch, patch = {}) => ({
  id: randomUUID(), username: 'admin', firstName: 'Artha', lastName: 'Marketing', email: 'a@akura.test', telp: null,
  role: 'ADMIN', section: 'MARKETING', officeBranchId: branch, isActive: true, version: 1,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...patch,
});

test('user sync stores only active ADMIN MARKETING users and removes ineligible rows', async () => {
  process.env.USER_SYNC_SECRET = 'test-secret-with-at-least-32-characters';
  await withUserSyncDatabase(path.resolve(__dirname, '..'), async prisma => {
    const { applyUserSyncEvent } = require('../dist/modules/user-sync/user-sync-events.routes.js');
    const branch = randomUUID();
    const user = snapshot(branch);
    const send = (version, patch = {}) => {
      const snap = { ...user, ...patch, version };
      return applyUserSyncEvent({ eventId: randomUUID(), officeBranchId: snap.officeBranchId, version, user: snap });
    };
    await send(1);
    assert.equal(await prisma.marketingAdminUser.count({ where: { officeBranchId: branch } }), 1);
    await send(2, { email: 'new@akura.test' });
    assert.equal((await prisma.marketingAdminUser.findUnique({ where: { id: user.id } })).user.email, 'new@akura.test');

    for (const patch of [{ role: 'USER' }, { section: 'FINANCE' }, { isActive: false }, { officeBranchId: null }]) {
      await send(3, patch);
      assert.equal(await prisma.marketingAdminUser.count({ where: { id: user.id } }), 0);
    }
    await send(7);
    assert.equal(await prisma.marketingAdminUser.count({ where: { id: user.id } }), 1);
    await send(8, { role: 'USER' });
    await send(1);
    assert.equal(await prisma.marketingAdminUser.count({ where: { id: user.id } }), 0);
    assert.equal((await prisma.marketingUserSyncRevision.findUnique({ where: { userId: user.id } })).version, 8);

    await assert.rejects(applyUserSyncEvent({}));
    await assert.rejects(applyUserSyncEvent({
      eventId: randomUUID(), officeBranchId: randomUUID(), version: 9,
      user: { ...user, version: 9 },
    }));
    assert.equal(await prisma.marketingAdminUser.count(), 0);
  });
});

test('HTTP receiver authenticates with the sync secret and acknowledges after commit', async () => {
  process.env.USER_SYNC_SECRET = 'test-secret-with-at-least-32-characters';
  await withUserSyncDatabase(path.resolve(__dirname, '..'), async prisma => {
    const app = require('../dist/app.js').default;
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try {
      const url = `http://127.0.0.1:${server.address().port}/internal/users/events`;
      const branch = randomUUID();
      const event = { eventId: randomUUID(), officeBranchId: branch, version: 1, user: snapshot(branch) };
      const headers = { 'content-type': 'application/json', 'x-gateway-secret': process.env.GATEWAY_SECRET };
      assert.equal((await fetch(url, { method: 'POST', headers, body: JSON.stringify(event) })).status, 403);
      assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, 'x-user-sync-secret': 'wrong' }, body: JSON.stringify(event) })).status, 403);
      assert.equal(await prisma.marketingAdminUser.count(), 0);
      assert.equal((await fetch(url, { method: 'POST', headers: { ...headers, 'x-user-sync-secret': process.env.USER_SYNC_SECRET }, body: '{}' })).status, 400);
      const response = await fetch(url, { method: 'POST', headers: { ...headers, 'x-user-sync-secret': process.env.USER_SYNC_SECRET }, body: JSON.stringify(event) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true, eventId: event.eventId });
      // A duplicate retry of the same event stays idempotent.
      await fetch(url, { method: 'POST', headers: { ...headers, 'x-user-sync-secret': process.env.USER_SYNC_SECRET }, body: JSON.stringify({ ...event, eventId: randomUUID() }) });
      assert.equal(await prisma.marketingAdminUser.count(), 1);
      assert.equal(await prisma.marketingAdminUser.count({ where: { officeBranchId: randomUUID() } }), 0);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  });
});
