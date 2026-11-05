/**
 * STRESS / LOAD - marketing-service.
 *
 * Measures throughput and latency under concurrent read and write load and
 * asserts that the responses stay consistent (no 5xx, no corrupted data).
 *
 * The metrics are recorded for the report; the assertions focus on
 * correctness, because a fast but incorrect service is not acceptable.
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  GATEWAY, loginAs, prismaFor, seedMarketingTax, seedOfficeBranch, seedUser,
  type SeededUser,
} from './support/fixtures.js';
import { httpRequest, syntheticName } from './support/http.js';
import { buildStressMetrics, type StressSample } from './support/metrics.js';
import { ensureDatabases, resetBeforeEach } from './support/suite.js';
import { startGateway, startService } from './support/processes.js';
import type { ServiceProcess } from './support/harness.js';

let auth: ServiceProcess;
let marketing: ServiceProcess;
let gateway: ServiceProcess;

let admin: SeededUser;
let branchId: string;

const COMPANIES = '/api/v1/marketing/companies';
/** The repository root is one level above the service folder. */
const REPORT_PATH = resolve(process.cwd(), '..', 'docs', 'testing', 'stress-report.json');

/** A sample set plus the wall-clock time the whole batch took. */
export interface LoadResult {
  samples: StressSample[];
  wallClockMs: number;
}

/**
 * Runs `total` requests with at most `concurrency` in flight at any time.
 * The worker pool keeps the load steady instead of firing everything at once.
 */
export const runLoad = async (
  total: number,
  concurrency: number,
  handler: (index: number) => Promise<{ status: number; durationMs: number; error?: string }>,
): Promise<LoadResult> => {
  const samples: StressSample[] = [];
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= total) return;
      try {
        const response = await handler(index);
        samples.push({
          status: response.status,
          durationMs: response.durationMs,
          ...(response.error ? { error: response.error } : {}),
        });
      } catch (error) {
        samples.push({ status: 0, durationMs: 0, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { samples, wallClockMs: performance.now() - started };
};

describe('marketing-service stress and load', () => {
  // Every test starts from an empty marketing database, so the write-load
  // counts are exact.
  resetBeforeEach(['marketing']);

  before(async () => {
    await ensureDatabases();
    auth = await startService('auth');
    marketing = await startService('marketing');
    gateway = await startGateway();
  });

  after(async () => {
    for (const process_ of [gateway, marketing, auth]) await process_?.stop();
  });

  beforeEach(async () => {
    const branch = await seedOfficeBranch();
    branchId = branch.id;
    await seedMarketingTax(branchId);
    admin = await seedUser({ role: 'ADMIN', section: 'MARKETING', officeBranchId: branchId });
    await loginAs(admin);
  });

  test('READ LOAD: 200 concurrent list requests all succeed without a 5xx', async () => {
    const TOTAL = 200;
    const CONCURRENCY = 20;
    const { samples, wallClockMs } = await runLoad(TOTAL, CONCURRENCY, async () => {
      const response = await httpRequest(`${GATEWAY}${COMPANIES}`, {
        token: admin.accessToken,
        timeoutMs: 30_000,
      });
      return { status: response.status, durationMs: response.durationMs };
    });
    const metrics = buildStressMetrics(CONCURRENCY, samples, wallClockMs);

    assert.equal(metrics.failed, 0, `no request may fail, saw ${JSON.stringify(metrics.statusCounts)}`);
    assert.equal(metrics.successful, TOTAL);
    for (const [status, count] of Object.entries(metrics.statusCounts)) {
      assert.ok(Number(status) < 500, `no 5xx is acceptable, saw ${count} responses with status ${status}`);
    }

    await mkdir(resolve(process.cwd(), '..', 'docs', 'testing'), { recursive: true });
    await writeFile(
      REPORT_PATH,
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        scenario: 'read-list',
        metrics,
      }, null, 2),
      'utf8',
    );
  });

  test('WRITE LOAD: concurrent company creates all persist exactly once', async () => {
    const TOTAL = 40;
    const CONCURRENCY = 10;

    // The catalog fixture already created one company in this branch, so the
    // load is measured as a delta.
    const counter = prismaFor('marketing');
    let companiesBeforeLoad = 0;
    try {
      companiesBeforeLoad = await counter.company.count({ where: { officeBranchId: branchId } });
    } finally {
      await counter.$disconnect();
    }

    const { samples, wallClockMs } = await runLoad(TOTAL, CONCURRENCY, async () => {
      const response = await httpRequest(`${GATEWAY}${COMPANIES}`, {
        method: 'POST',
        token: admin.accessToken,
        body: {
          name: syntheticName('COMPANY'), type: 'PT', address: 'RelTest address',
          npwp: '00.000.000.0-000.000', isSisterCompany: false,
        },
        timeoutMs: 30_000,
      });
      return { status: response.status, durationMs: response.durationMs };
    });
    const metrics = buildStressMetrics(CONCURRENCY, samples, wallClockMs);

    assert.equal(metrics.failed, 0, `no create may fail, saw ${JSON.stringify(metrics.statusCounts)}`);
    assert.equal(metrics.successful, TOTAL);

    // Every request used a unique name, so every row must exist exactly once.
    const prisma = prismaFor('marketing');
    try {
      const persisted = await prisma.company.count({ where: { officeBranchId: branchId } });
      assert.equal(
        persisted - companiesBeforeLoad,
        TOTAL,
        'every accepted create must be persisted exactly once',
      );
      // No duplicate rows may have slipped through the name uniqueness guard.
      const groups = await prisma.company.groupBy({
        by: ['normalizeName'],
        where: { officeBranchId: branchId },
        _count: { _all: true },
      });
      for (const group of groups) {
        assert.equal(group._count._all, 1, `duplicate company name ${group.normalizeName} was persisted`);
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  test('MIXED LOAD: concurrent reads and writes never produce a server error', async () => {
    const TOTAL = 100;
    const CONCURRENCY = 12;
    const { samples, wallClockMs } = await runLoad(TOTAL, CONCURRENCY, async (index) => {
      const response = index % 2 === 0
        ? await httpRequest(`${GATEWAY}${COMPANIES}`, { token: admin.accessToken, timeoutMs: 30_000 })
        : await httpRequest(`${GATEWAY}${COMPANIES}`, {
          method: 'POST',
          token: admin.accessToken,
          body: {
            name: syntheticName('COMPANY'), type: 'PT', address: 'RelTest address',
            npwp: '00.000.000.0-000.000', isSisterCompany: false,
          },
          timeoutMs: 30_000,
        });
      return { status: response.status, durationMs: response.durationMs };
    });
    const metrics = buildStressMetrics(CONCURRENCY, samples, wallClockMs);

    assert.equal(metrics.failed, 0, `no request may fail, saw ${JSON.stringify(metrics.statusCounts)}`);
    for (const [status, count] of Object.entries(metrics.statusCounts)) {
      assert.ok(Number(status) < 500, `no 5xx is acceptable, saw ${count} responses with status ${status}`);
    }
  });
});
