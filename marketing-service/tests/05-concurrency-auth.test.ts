/**
 * CONCURRENCY - auth-service.
 *
 * Covers the operations that decide identity state:
 *   - the optimistic version guard on profile updates (lost update)
 *   - refresh token rotation and reuse detection (idempotency)
 *   - concurrent registration of the same username (uniqueness)
 *   - the user history audit trail
 *   - the role-based visibility of the user list
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GATEWAY, authActiveTokenCount, authUser, authUserCount, execute, loginAs, query,
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

describe('auth-service user list visibility', () => {
  // The visibility of the user list depends on the role of the caller, so the
  // auth database is reset before each test to keep the seeded users known.
  resetBeforeEach(['auth']);

  before(async () => {
    await ensureDatabases();
    auth = await startService('auth');
    gateway = await startGateway();
  });

  after(async () => {
    for (const process_ of [gateway, auth]) await process_?.stop();
  });

  /** The users returned by the list endpoint, with the pagination envelope. */
  const listUsers = async (token: string, query = '') => {
    const response = await httpRequest(`${GATEWAY}${AUTH}/users${query}`, { token });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    const data = (response.body as {
      data: { users: Array<Record<string, unknown>>; pagination: { page: number; limit: number; total: number; totalPages: number } };
    }).data;
    return { users: data.users, pagination: data.pagination, response };
  };

  /** Deactivates a user directly, because deactivation is an administrative act. */
  const deactivate = async (userId: string): Promise<void> => {
    await execute('auth', 'UPDATE users SET is_active = false WHERE id = $1::uuid', userId);
  };

  test('APP MANAGER: an app manager sees the users of every branch, including the deactivated ones', async () => {
    const branch = await seedOfficeBranch();
    const otherBranch = await seedOfficeBranch();
    const manager = await seedUser({ role: 'APP_MANAGER', section: 'MARKETING', officeBranchId: branch.id });
    const ownBranchUser = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: branch.id });
    const otherBranchUser = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: otherBranch.id });
    const deactivated = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: otherBranch.id });
    await deactivate(deactivated.id);
    await loginAs(manager);

    const { users } = await listUsers(manager.accessToken);
    const ids = users.map((user) => user.id);
    assert.ok(ids.includes(ownBranchUser.id), 'an app manager must see the users of their own branch');
    assert.ok(ids.includes(otherBranchUser.id), 'an app manager must see the users of another branch');
    assert.ok(ids.includes(deactivated.id), 'an app manager must see the deactivated users');
  });

  test('VISIBILITY: a caller that is not an app manager sees only the active users of their own branch', async () => {
    const branch = await seedOfficeBranch();
    const otherBranch = await seedOfficeBranch();
    const caller = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: branch.id });
    const ownBranchUser = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: branch.id });
    const otherBranchUser = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: otherBranch.id });
    const deactivated = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: branch.id });
    await deactivate(deactivated.id);
    await loginAs(caller);

    const { users } = await listUsers(caller.accessToken);
    const ids = users.map((user) => user.id);
    assert.ok(ids.includes(caller.id), 'a caller must see themselves');
    assert.ok(ids.includes(ownBranchUser.id), 'a caller must see the active users of their own branch');
    assert.ok(!ids.includes(otherBranchUser.id), 'a user of another branch must not be visible');
    assert.ok(!ids.includes(deactivated.id), 'a deactivated user must not be visible');
  });

  test('VISIBILITY: the response of a caller that is not an app manager carries only the summary fields', async () => {
    const branch = await seedOfficeBranch();
    const caller = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: branch.id });
    await loginAs(caller);

    const { users } = await listUsers(caller.accessToken);
    assert.ok(users.length > 0, 'the list must not be empty');
    const expected = ['id', 'firstName', 'lastName', 'email', 'telp', 'role', 'section', 'branch'];
    for (const user of users) {
      assert.deepEqual(
        Object.keys(user).sort(),
        [...expected].sort(),
        `the summary must carry exactly ${expected.join(', ')}`,
      );
      // The account metadata must not leak through the summary.
      for (const forbidden of ['username', 'officeBranchId', 'isActive', 'version', 'createdAt', 'updatedAt']) {
        assert.equal(user[forbidden], undefined, `${forbidden} must not be exposed to a non app manager`);
      }
    }
  });

  test('VISIBILITY: a client-supplied branch or activation filter cannot widen the scope of a caller', async () => {
    const branch = await seedOfficeBranch();
    const otherBranch = await seedOfficeBranch();
    const caller = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: branch.id });
    const otherBranchUser = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: otherBranch.id });
    const deactivated = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: branch.id });
    await deactivate(deactivated.id);
    await loginAs(caller);

    // Asking for another branch must not reveal that branch.
    const other = await listUsers(caller.accessToken, `?officeBranchId=${otherBranch.id}`);
    assert.ok(
      !other.users.map((user) => user.id).includes(otherBranchUser.id),
      'the branch filter must not widen the scope',
    );

    // Asking for the deactivated users must not reveal them either. The
    // activation filter is overridden with true, so the list is the active
    // users of the caller's branch and the deactivated user is not in it.
    const inactive = await listUsers(caller.accessToken, '?isActive=false');
    assert.ok(
      !inactive.users.map((user) => user.id).includes(deactivated.id),
      'the activation filter must not widen the scope',
    );
    assert.ok(
      inactive.users.every((user) => user.id !== deactivated.id),
      'no deactivated user may be returned',
    );
    assert.equal(inactive.pagination.total, 1, 'only the active user of the branch may be counted');
  });

  test('VISIBILITY: a caller without an office branch assignment receives an empty list', async () => {
    const branch = await seedOfficeBranch();
    const caller = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: branch.id });
    // The branch assignment is cleared directly, because the API requires a
    // branch for a user write.
    await execute('auth', 'UPDATE users SET office_branch_id = NULL WHERE id = $1::uuid', caller.id);
    await loginAs(caller);

    const { users, pagination } = await listUsers(caller.accessToken);
    assert.equal(users.length, 0, 'a caller without a branch must not see any user');
    assert.equal(pagination.total, 0, 'the total must be zero as well');
  });

  test('VISIBILITY: the filters, the pagination, and the sorting still apply to a caller that is not an app manager', async () => {
    const branch = await seedOfficeBranch();
    const caller = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: branch.id });
    const financeUser = await seedUser({ role: 'USER', section: 'FINANCE', officeBranchId: branch.id });
    await loginAs(caller);

    // The section filter narrows the list.
    const finance = await listUsers(caller.accessToken, '?section=FINANCE');
    assert.ok(
      finance.users.every((user) => user.section === 'FINANCE'),
      'the section filter must apply',
    );
    assert.ok(finance.users.map((user) => user.id).includes(financeUser.id), 'the matching user must be returned');

    // The pagination envelope reports the total of the scoped list.
    const paged = await listUsers(caller.accessToken, '?limit=1');
    assert.equal(paged.users.length, 1, 'the limit must apply');
    assert.equal(paged.pagination.limit, 1, 'the limit must be echoed');
    assert.ok(paged.pagination.total >= 1, 'the total must count the scoped users');

    // The sorting is applied by the requested sort, ascending by first name.
    const sorted = await listUsers(caller.accessToken, '?sortBy=firstName&sortOrder=asc');
    const names = sorted.users.map((user) => String(user.firstName));
    assert.deepEqual(names, [...names].sort(), 'the requested sort order must apply');
  });
});
