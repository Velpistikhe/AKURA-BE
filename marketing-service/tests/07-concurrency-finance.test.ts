/**
 * CONCURRENCY - finance-service tax revisions.
 *
 * The tax revision counter is the source of the version that the marketing
 * consumer uses to reject stale events. This suite asserts that concurrent
 * tax creations produce a gapless, unique revision sequence, and that the
 * effective periods of the branch never overlap.
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GATEWAY, loginAs, query, seedOfficeBranch, seedUser, type SeededUser,
} from './support/fixtures.js';
import { httpRequest } from './support/http.js';
import { Barrier } from './support/metrics.js';
import { ensureDatabases, resetBeforeEach } from './support/suite.js';
import { startGateway, startService } from './support/processes.js';
import type { ServiceProcess } from './support/harness.js';

let auth: ServiceProcess;
let finance: ServiceProcess;
let gateway: ServiceProcess;

let accountant: SeededUser;
let branchId: string;

const TAXES = '/api/v1/finance/taxes';

/** Builds a tax payload with a distinct effective date. */
const taxBody = (percentage: string, effectiveFrom: string) => ({ percentage, effectiveFrom });

describe('finance-service tax concurrency', () => {
  // Every test starts from an empty finance database, so the revision counter
  // is asserted against a known state.
  resetBeforeEach(['finance']);

  before(async () => {
    await ensureDatabases();
    auth = await startService('auth');
    finance = await startService('finance');
    gateway = await startGateway();
  });

  after(async () => {
    for (const process_ of [gateway, finance, auth]) await process_?.stop();
  });

  beforeEach(async () => {
    const branch = await seedOfficeBranch();
    branchId = branch.id;
    accountant = await seedUser({ role: 'ADMIN', section: 'FINANCE', officeBranchId: branchId });
    await loginAs(accountant);
  });

  test('REVISION COUNTER: concurrent tax creations produce a gapless revision sequence', async () => {
    const base = Date.now() - 86_400_000 * 30;
    const TOTAL = 5;
    const barrier = new Barrier(TOTAL);
    const responses = await Promise.all(Array.from({ length: TOTAL }, async (_, index) => {
      await barrier.wait();
      // Each request uses a distinct effective date. The service serializes
      // the writes with a branch advisory lock and rejects a date that is not
      // later than the latest stored one, so some requests are legitimately
      // refused with 409 depending on the order they win the lock.
      const effectiveFrom = new Date(base + index * 86_400_000).toISOString().slice(0, 10);
      return httpRequest(`${GATEWAY}${TAXES}`, {
        method: 'POST',
        token: accountant.accessToken,
        body: taxBody('11', effectiveFrom),
      });
    }));

    // No request may fail with a server error; only 201 and 409 are acceptable.
    for (const response of responses) {
      assert.ok(
        response.status === 201 || response.status === 409,
        `unexpected status ${response.status}: ${JSON.stringify(response.body)}`,
      );
    }
    const succeeded = responses.filter((response) => response.status === 201).length;
    assert.ok(succeeded >= 1, 'at least one tax creation must succeed');

    const revisions = await query<{ version: number }>(
      'finance',
      'SELECT version FROM tax_revisions WHERE "officeBranchId" = $1::uuid',
      branchId,
    );
    assert.equal(revisions.length, 1, 'exactly one revision row may exist per branch');
    // One revision is consumed per accepted tax creation.
    assert.equal(revisions[0].version, succeeded, `the revision must equal the number of accepted writes (${succeeded})`);

    // Every revision event must carry a unique, gapless version.
    const events = await query<{ version: number }>(
      'finance',
      'SELECT version FROM tax_events WHERE "officeBranchId" = $1::uuid ORDER BY version',
      branchId,
    );
    const versions = events.map((event) => event.version);
    assert.equal(new Set(versions).size, versions.length, `duplicate event versions: ${versions.join(', ')}`);
    assert.deepEqual(
      versions,
      Array.from({ length: succeeded }, (_, index) => index + 1),
      `the event versions must be gapless, got ${versions.join(', ')}`,
    );
  });

  test('EFFECTIVE PERIOD: concurrent tax creations never overlap in one branch', async () => {
    const base = Date.now() - 86_400_000 * 30;
    const TOTAL = 5;
    const barrier = new Barrier(TOTAL);
    const responses = await Promise.all(Array.from({ length: TOTAL }, async (_, index) => {
      await barrier.wait();
      const effectiveFrom = new Date(base + index * 86_400_000).toISOString().slice(0, 10);
      return httpRequest(`${GATEWAY}${TAXES}`, {
        method: 'POST',
        token: accountant.accessToken,
        body: taxBody('11', effectiveFrom),
      });
    }));
    for (const response of responses) {
      assert.ok(
        response.status === 201 || response.status === 409,
        `unexpected status ${response.status}: ${JSON.stringify(response.body)}`,
      );
    }
    const succeeded = responses.filter((response) => response.status === 201).length;

    const taxes = await query<{
      effective_from: Date; effective_until: Date | null;
    }>(
      'finance',
      `SELECT effective_from, effective_until FROM taxes
       WHERE office_branch_id = $1::uuid ORDER BY effective_from`,
      branchId,
    );
    assert.equal(taxes.length, succeeded, 'the stored tax rows must match the accepted writes');

    // Consecutive periods must not overlap: the previous period ends the day
    // before the next one starts.
    for (let index = 1; index < taxes.length; index += 1) {
      const previous = taxes[index - 1];
      const current = taxes[index];
      const previousEnd = new Date(previous.effective_until ?? previous.effective_from).getTime();
      const currentStart = new Date(current.effective_from).getTime();
      assert.ok(
        previousEnd < currentStart,
        `tax periods overlap: ${new Date(previousEnd).toISOString()} is not before ${new Date(currentStart).toISOString()}`,
      );
    }
  });

  test('ORDERING GUARD: a tax effective before the latest one is rejected with 409', async () => {
    const latest = new Date(Date.now() - 86_400_000 * 10).toISOString().slice(0, 10);
    const first = await httpRequest(`${GATEWAY}${TAXES}`, {
      method: 'POST',
      token: accountant.accessToken,
      body: taxBody('11', latest),
    });
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const older = await httpRequest(`${GATEWAY}${TAXES}`, {
      method: 'POST',
      token: accountant.accessToken,
      body: taxBody('12', new Date(Date.now() - 86_400_000 * 20).toISOString().slice(0, 10)),
    });
    assert.equal(older.status, 409, JSON.stringify(older.body));
  });
});
