import assert from 'node:assert/strict';
import { enqueueUserSync } from '../dist/modules/user-sync/user-sync.service.js';
import { retryDelay } from '../dist/modules/user-sync/user-sync.delivery.js';

// Outbox enqueue writes the full snapshot plus a delivery row in the caller's
// transaction (mirrors the transactional contract used by user mutations).
const created = [];
const tx = {
  userSyncEvent: {
    create: async ({ data }) => {
      created.push(data);
      return { id: 'event-id', ...data, deliveries: { length: 1 } };
    },
  },
};
const user = {
  id: '00000000-0000-4000-8000-000000000001', username: 'admin', firstName: 'Artha', lastName: 'Marketing',
  email: 'artha@akura.test', telp: null, role: 'ADMIN', section: 'MARKETING',
  officeBranchId: '00000000-0000-4000-8000-000000000002', isActive: true,
  version: 4, createdAt: new Date(), updatedAt: new Date(),
};
const eventId = await enqueueUserSync(tx, user);
assert.equal(typeof eventId, 'string');
assert.equal(created.length, 1);
assert.equal(created[0].userId, user.id);
assert.equal(created[0].version, user.version);
assert.deepEqual(JSON.parse(JSON.stringify(created[0].payload)), JSON.parse(JSON.stringify(user)));
assert.equal(Object.hasOwn(created[0].payload, 'normalizeUsername'), false, 'internal normalizeUsername must not enter sync payload');
// Marketing always receives an event; Field Service only when eligible.
assert.deepEqual(created[0].deliveries.create, [{ targetService: 'marketing-service' }]);

const fieldServiceUser = {
  id: '00000000-0000-4000-8000-000000000003', username: 'inspector', firstName: 'Budi', lastName: 'Inspector',
  email: null, telp: null, role: 'USER', section: 'FIELD_SERVICE',
  officeBranchId: '00000000-0000-4000-8000-000000000002', isActive: true,
  version: 1, createdAt: new Date(), updatedAt: new Date(),
};
await enqueueUserSync(tx, fieldServiceUser);
assert.deepEqual(created[1].deliveries.create, [
  { targetService: 'marketing-service' },
  { targetService: 'fieldservice-service' },
]);
// Losing FIELD_SERVICE eligibility still delivers a removal event to Field Service.
await enqueueUserSync(tx, { ...fieldServiceUser, section: 'MARKETING' }, { previous: fieldServiceUser });
assert.deepEqual(created[2].deliveries.create, [
  { targetService: 'marketing-service' },
  { targetService: 'fieldservice-service' },
]);
// A user never eligible for Field Service does not create a Field Service delivery.
await enqueueUserSync(tx, { ...user, role: 'USER', section: 'FINANCE' }, { previous: { ...user, role: 'USER', section: 'FINANCE' } });
assert.deepEqual(created[3].deliveries.create, [{ targetService: 'marketing-service' }]);

// Source-level guard: every enqueue caller must wake the delivery worker after
// the transaction commits; otherwise events wait until the next restart.
import { readFileSync } from 'node:fs';
for (const file of ['../src/modules/auth/auth.service.ts', '../src/modules/user-management/user-management.service.ts']) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  assert.match(source, /wakeUserSync\(\);/, `${file} must wake the user-sync worker after enqueue`);
  assert.ok(source.indexOf('wakeUserSync();') > source.indexOf('enqueueUserSync('), `${file} must wake the worker after the outbox row is committed`);
}

// Profile updates must enqueue only eligible Marketing administrators or
// Field Service users and log the non-eligible branch explicitly.
const authSource = readFileSync(new URL('../src/modules/auth/auth.service.ts', import.meta.url), 'utf8');
assert.match(authSource, /isMarketingUserSyncCandidate\(updated\) \|\| isMarketingUserSyncCandidate\(user\)/);
assert.match(authSource, /isFieldServiceUserSyncCandidate\(updated\) \|\| isFieldServiceUserSyncCandidate\(user\)/);
assert.match(authSource, /Profile updated without user sync eligibility/);
// Delivery resolves the receiver path per target service.
const deliverySource = readFileSync(new URL('../src/modules/user-sync/user-sync.delivery.ts', import.meta.url), 'utf8');
assert.match(deliverySource, /'fieldservice\/internal\/users\/events'/);
assert.match(deliverySource, /USER_SYNC_PATHS\[job\.targetService as UserSyncTarget\]/);

// Retry backoff stays bounded for the delivery worker.
assert.equal(retryDelay(1), 10000);
assert.ok(retryDelay(20) <= 300000);

console.log('PASS: user sync outbox enqueue payload, delivery target and retry backoff.');
