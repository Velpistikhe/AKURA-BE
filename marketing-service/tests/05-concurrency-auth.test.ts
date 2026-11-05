/**
 * CONCURRENCY - auth-service.
 *
 * Covers the operations that decide identity state:
 *   - the optimistic version guard on profile updates (lost update)
 *   - refresh token rotation and reuse detection (idempotency)
 *   - concurrent registration of the same username (uniqueness)
 *   - the user history audit trail
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GATEWAY, authActiveTokenCount, authUser, authUserCount, loginAs, query,
  seedOfficeBranch, seedUser, type SeededUser,
} from './support/fixtures.js';
import { httpRequest, syntheticUsername, TEST_PASSWORD } from './support/http.js';
import { Barrier } from './support/metrics.js';
import { ensureDatabases, resetBeforeEach } from './support/suite.js';
import { startGateway, startService } from './support/processes.js';
import type { ServiceProcess } from './support/harness.js';

let auth: ServiceProcess;
let gateway: ServiceProcess;

let admin: SeededUser;
let branchId: string;

const AUTH = '/api/v1/auth';

describe('auth-service concurrency', () => {
  // Every test starts from an empty auth database, so the uniqueness and
  // rotation invariants are asserted against a known state.
  resetBeforeEach(['auth']);

  before(async () => {
    await ensureDatabases();
    auth = await startService('auth');
    gateway = await startGateway();
  });

  after(async () => {
    for (const process_ of [gateway, auth]) await process_?.stop();
  });

  beforeEach(async () => {
    const branch = await seedOfficeBranch();
    branchId = branch.id;
    admin = await seedUser({ role: 'ADMIN', section: 'MARKETING', officeBranchId: branchId });
    await loginAs(admin);
  });

  test('LOST UPDATE: concurrent profile updates are serialized by the row lock', async () => {
    const user = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: branchId });
    await loginAs(user);

    const profile = await httpRequest(`${GATEWAY}${AUTH}/me`, { token: user.accessToken });
    assert.equal(profile.status, 200, JSON.stringify(profile.body));
    const version = (profile.body as { data: { version: number } }).data.version;

    // The profile endpoint does not accept a client-supplied version. It locks
    // the user row FOR UPDATE and applies the write with the version it read
    // under that lock, so the two requests are serialized instead of racing.
    const barrier = new Barrier(2);
    const attempt = async (firstName: string) => {
      await barrier.wait();
      return httpRequest(`${GATEWAY}${AUTH}/profile`, {
        method: 'PUT',
        token: user.accessToken,
        body: { firstName, lastName: 'Test', email: user.username + '@reltest.local', telp: '0000' },
      });
    };

    const [first, second] = await Promise.all([attempt('WinnerA'), attempt('WinnerB')]);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(second.status, 200, JSON.stringify(second.body));

    const row = await authUser(user.id);
    assert.ok(row, 'the user row must exist');
    // Both writes were applied in sequence: the version advanced twice, so no
    // update was lost.
    assert.equal(row.version, version + 2, 'both updates must be applied exactly once');
    assert.ok(
      ['WinnerA', 'WinnerB'].includes(row.firstName),
      `the stored value must be one of the submitted values, got ${row.firstName}`,
    );

    // The audit trail must contain one history row per applied version.
    const histories = await query<{ version: number }>(
      'auth',
      'SELECT version FROM user_histories WHERE user_id = $1::uuid ORDER BY version',
      user.id,
    );
    const versions = histories.map((row) => row.version);
    assert.equal(new Set(versions).size, versions.length, `duplicate history versions: ${versions.join(', ')}`);
    assert.equal(versions.length, 3, 'expected CREATE plus two UPDATE history rows');
  });

  test('UNIQUE KEY: concurrent registration of the same username creates exactly one account', async () => {
    const username = syntheticUsername();
    const body = {
      username,
      password: TEST_PASSWORD,
      passwordConfirmation: TEST_PASSWORD,
      firstName: 'Rel',
      lastName: 'Test',
    };

    const barrier = new Barrier(4);
    const attempts = Array.from({ length: 4 }, async () => {
      await barrier.wait();
      return httpRequest(`${GATEWAY}${AUTH}/register`, { method: 'POST', body });
    });
    const responses = await Promise.all(attempts);

    const created = responses.filter((response) => response.status === 200 || response.status === 201);
    const rejected = responses.filter((response) => response.status === 409);
    assert.equal(created.length, 1, `exactly one registration may succeed, saw ${created.length}`);
    assert.equal(rejected.length, 3, `the others must be rejected with 409, saw ${rejected.map((r) => r.status).join(', ')}`);

    const rows = await authUserCount(username.toLowerCase());
    assert.equal(rows, 1, 'exactly one user row may exist');
  });

  test('REFRESH TOKEN: concurrent use of one refresh token issues one new token family', async () => {
    const user = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: branchId });
    await loginAs(user);

    // The refresh token is delivered as an httpOnly cookie; it is read back
    // from the login response headers.
    const login = await httpRequest(`${GATEWAY}${AUTH}/login`, {
      method: 'POST',
      body: { username: user.username, password: user.password },
    });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const refreshCookie = login.headers.getSetCookie?.()
      .find((cookie) => cookie.startsWith('refreshToken='));
    const refreshToken = refreshCookie
      ? decodeURIComponent(refreshCookie.split(';')[0].slice('refreshToken='.length))
      : undefined;
    assert.ok(refreshToken, 'login must set a refreshToken cookie');

    const barrier = new Barrier(2);
    const attempt = async () => {
      await barrier.wait();
      return httpRequest(`${GATEWAY}${AUTH}/refresh-token`, {
        method: 'POST',
        headers: { 'x-refresh-token': refreshToken },
      });
    };
    const [first, second] = await Promise.all([attempt(), attempt()]);

    // The token row is locked FOR UPDATE, so exactly one rotation may succeed.
    const succeeded = [first, second].filter((response) => response.status === 200);
    assert.equal(succeeded.length, 1, `exactly one rotation may succeed, got ${[first.status, second.status].join(', ')}`);

    const tokens = await authActiveTokenCount(user.id);
    assert.ok(tokens >= 1, 'a valid session must survive the rotation');
  });
});
