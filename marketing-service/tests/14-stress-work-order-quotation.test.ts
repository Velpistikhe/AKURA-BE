/**
 * STRESS / LOAD - the quotation-backed Work Order creation path.
 *
 * This is the path that was changed: the creation now validates the quotation
 * against Marketing, checks the mirrored link, validates the mirrored link under Marketing locking, and Field Service takes a branch-scoped advisory lock.
 *
 * The scenarios measure throughput and latency under concurrent load and then
 * assert the invariant that matters: a quotation backs at most one live Work
 * Order, and a rejected request never leaves a row behind.
 */
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  GATEWAY, loginAs, query, seedMarketingTax, seedOfficeBranch, seedUser,
  type SeededUser,
} from './support/fixtures.js';
import { buildCatalogFixture, createSubmittedQuotation, type CatalogFixture, workOrderFromMarketingCreate } from './support/catalog.js';
import { httpRequest } from './support/http.js';
import { buildStressMetrics, runLoad, waitFor } from './support/metrics.js';
import { ensureDatabases, resetBeforeEach } from './support/suite.js';
import { startGateway, startService } from './support/processes.js';
import type { ServiceProcess } from './support/harness.js';

let auth: ServiceProcess;
let marketing: ServiceProcess;
let fieldservice: ServiceProcess;
let gateway: ServiceProcess;

let admin: SeededUser;
let officer: SeededUser;
let branchId: string;
let fixture: CatalogFixture;

const WORK_ORDERS = '/api/v1/fieldservice/work-orders';
/** The repository root is one level above the service folder. */
const REPORT_PATH = resolve(process.cwd(), '..', 'docs', 'testing', 'work-order-quotation-stress-report.json');

const dayAfter = (iso: string): string => {
  const date = new Date(`${iso}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/**
 * Creates an approved quotation that can back a Work Order.
 *
 * Approving a quotation renders a PDF and stores it, which is the slowest part
 * of the preparation. The approval is retried a few times, because a busy
 * object store or a saturated connection pool may answer with a transient
 * error. A failure here is a preparation problem, not a measurement of the
 * Work Order path, so it must not be reported as one.
 */
const approvedQuotation = async (): Promise<string> => {
  const submitted = await createSubmittedQuotation(admin.accessToken, fixture);
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await httpRequest(`${GATEWAY}/api/v1/marketing/quotations/${submitted.id}/approve`, {
      method: 'POST',
      token: admin.accessToken,
      body: { version: submitted.version },
      timeoutMs: 120_000,
    });
    if (response.status === 200) return submitted.id;
    lastError = `HTTP ${response.status} ${JSON.stringify(response.body)}`;
    if (response.status >= 400 && response.status < 500) break;
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  throw new Error(`Unable to approve the prepared quotation: ${lastError}`);
};

/**
 * Creates a Work Order from a quotation as the marketing officer.
 *
 * The inspector name is unique per call. An inspector may not hold two
 * overlapping Work Orders, so a shared name would make the second Work Order
 * of a batch collide on the inspector schedule instead of measuring the
 * quotation path.
 */
const createFromQuotation = async (quotationId: string, inspectorName?: string) => {
  const today = new Date().toISOString().slice(0, 10);
  return httpRequest(`${GATEWAY}/api/v1/marketing/quotations/${quotationId}/work-order`, {
    method: 'POST',
    token: officer.accessToken,
    body: {
      startDate: today,
      endDate: dayAfter(today),
      inspectors: [inspectorName ?? `StressTest Inspector ${randomUUID().slice(0, 8)}`],
      items: [{ itemSizeId: fixture.itemSizeId, quantityInspection: 1, quantityMaintenance: 0 }],
    },
    timeoutMs: 60_000,
  });
};

/** The number of live Work Orders that reference the quotation. */
const liveWorkOrdersFor = async (quotationId: string): Promise<number> => {
  const rows = await query<{ count: string }>(
    'fieldservice',
    'SELECT COUNT(*)::text AS count FROM work_order WHERE quotation_id = $1::uuid AND revoked = false',
    quotationId,
  );
  return Number(rows[0]?.count ?? 0);
};

/**
 * Maps over `count` items with a bounded number of parallel tasks.
 *
 * The preparation step is deliberately throttled: every quotation costs a
 * Marketing transaction, and the Prisma pool of the service under test has a
 * fixed size. Firing all preparations at once exhausts the pool and reports a
 * connection problem instead of a measurement of the Work Order path.
 */
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  handler: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await handler(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
};

/** Prepares `count` approved quotations with a bounded parallelism. */
const prepareQuotations = async (count: number): Promise<string[]> => {
  const indexes = Array.from({ length: count }, (_, index) => index);
  return mapWithConcurrency(indexes, 4, async () => approvedQuotation());
};

/**
 * Writes the stress report next to the existing one.
 *
 * Every scenario is kept in the same file, so the report shows the whole
 * picture instead of only the scenario that ran last. A previous report is
 * read first, so the file stays useful across runs.
 */
const writeReport = async (scenario: string, metrics: ReturnType<typeof buildStressMetrics>) => {
  await mkdir(resolve(REPORT_PATH, '..'), { recursive: true });
  let existing: { generatedAt?: string; scenarios?: Array<{ scenario: string; metrics: unknown }> } = {};
  try {
    existing = JSON.parse(await readFile(REPORT_PATH, 'utf8')) as typeof existing;
  } catch {
    // A missing or unreadable report simply starts a new one.
  }
  const scenarios = (existing.scenarios ?? []).filter(entry => entry.scenario !== scenario);
  scenarios.push({ scenario, metrics });
  await writeFile(
    REPORT_PATH,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      environment: 'local PostgreSQL, 8 CPU, Node.js test harness',
      scenarios,
    }, null, 2),
    'utf8',
  );
};

describe('fieldservice-service quotation work order stress and load', () => {
  // Every test starts from an empty marketing and field-service database.
  resetBeforeEach(['marketing', 'fieldservice']);

  before(async () => {
    await ensureDatabases();
    auth = await startService('auth');
    marketing = await startService('marketing');
    fieldservice = await startService('fieldservice');
    gateway = await startGateway();
  });

  after(async () => {
    for (const process_ of [gateway, fieldservice, marketing, auth]) await process_?.stop();
  });

  afterEach(async () => {
    // The write scenarios keep the delivery worker busy for a moment after the
    // response. The next scenario truncates the tables, and a truncate that
    // runs while a request is still in flight deadlocks against it. Waiting
    // for the queues to settle keeps the scenarios independent.
    await new Promise(resolve => setTimeout(resolve, 1500));
  });

  beforeEach(async () => {
    const branch = await seedOfficeBranch();
    branchId = branch.id;
    await seedMarketingTax(branchId);
    admin = await seedUser({ role: 'ADMIN', section: 'MARKETING', officeBranchId: branchId });
    await loginAs(admin);
    officer = await seedUser({ role: 'USER', section: 'MARKETING', officeBranchId: branchId });
    await loginAs(officer);
    fixture = await buildCatalogFixture(admin.accessToken);
  });

  test('CONTENDED CREATE: concurrent creations for one quotation yield exactly one Work Order', async () => {
    const quotationId = await approvedQuotation();
    const TOTAL = 12;

    // Every request targets the same quotation, so the advisory lock and the
    // duplicate check decide the outcome. Exactly one may win.
    const { samples, wallClockMs } = await runLoad(TOTAL, TOTAL, async () => {
      const response = await createFromQuotation(quotationId);
      return { status: response.status, durationMs: response.durationMs };
    });
    const metrics = buildStressMetrics(TOTAL, samples, wallClockMs);
    await writeReport('contended-create', metrics);

    const created = samples.filter((sample) => sample.status === 201).length;
    const rejected = samples.filter((sample) => sample.status === 409).length;
    assert.equal(created, 1, `exactly one create may win, saw ${created} accepted`);
    assert.equal(rejected, TOTAL - 1, `every other request must be refused with 409, saw ${rejected}`);
    assert.equal(await liveWorkOrdersFor(quotationId), 1, 'the quotation must back exactly one live Work Order');
    for (const sample of samples) {
      assert.ok(sample.status < 500, `no 5xx is acceptable, saw status ${sample.status}`);
    }
  });

  test('PARALLEL CREATE: concurrent creations for distinct quotations all succeed', async () => {
    const TOTAL = 24;
    const CONCURRENCY = 12;

    // Each quotation has its own lock, so the load must scale. The quotations
    // are prepared first, so only the creation path is under load.
    const quotationIds = await prepareQuotations(TOTAL);

    const { samples, wallClockMs } = await runLoad(TOTAL, CONCURRENCY, async (index) => {
      const response = await createFromQuotation(quotationIds[index]);
      // A refusal message is kept, so a failing scenario reports why it was
      // refused instead of only how many refusals there were.
      const message = response.status >= 400
        ? String((response.body as { message?: string } | null)?.message ?? response.status)
        : undefined;
      return { status: response.status, durationMs: response.durationMs, ...(message ? { error: message } : {}) };
    });
    const metrics = buildStressMetrics(CONCURRENCY, samples, wallClockMs);
    await writeReport('parallel-create', metrics);

    if (metrics.failed > 0) {
      // A server error is a real finding, so the service log is dumped next to
      // the assertion. The reason is usually only visible in the log.
      const log = [...fieldservice.output, ...marketing.output].join('\n');
      const tail = log.split('\n').filter(line => /error|Error|ERROR|Prisma|timeout/i.test(line)).slice(-25).join('\n');
      assert.fail(`no create may fail, saw ${JSON.stringify(metrics.statusCounts)}\n${tail}`);
    }
    assert.equal(metrics.successful, TOTAL);
    assert.equal(metrics.successful, TOTAL);
    for (const quotationId of quotationIds) {
      assert.equal(await liveWorkOrdersFor(quotationId), 1, `quotation ${quotationId} must back exactly one Work Order`);
    }
  });

  test('DUPLICATE LOAD: concurrent creates for one quotation yield one 201 and the rest 409', async () => {
    const TOTAL = 20;
    const CONCURRENCY = 10;
    const quotationId = await approvedQuotation();

    const { samples, wallClockMs } = await runLoad(TOTAL, CONCURRENCY, async () => {
      const response = await createFromQuotation(quotationId);
      return { status: response.status, durationMs: response.durationMs };
    });
    const metrics = buildStressMetrics(CONCURRENCY, samples, wallClockMs);
    await writeReport('duplicate-quotation-create', metrics);

    assert.equal(metrics.statusCounts[201] ?? 0, 1, 'exactly one create may succeed');
    assert.equal((metrics.statusCounts[409] ?? 0) + (metrics.statusCounts[201] ?? 0), TOTAL);
    assert.equal(await liveWorkOrdersFor(quotationId), 1, 'only one live Work Order may exist');
    assert.equal(metrics.timeouts, 0, 'no request may time out');
  });
  test('REVOKE LOAD: revoking many Work Orders keeps the quotation link consistent', async () => {
    const TOTAL = 12;
    const CONCURRENCY = 6;

    const quotationIds = await prepareQuotations(TOTAL);
    const workOrders: Array<{ id: string; version: number }> = [];
    for (const quotationId of quotationIds) {
      const created = await createFromQuotation(quotationId);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      workOrders.push(workOrderFromMarketingCreate(created.body));
    }

    const { samples, wallClockMs } = await runLoad(TOTAL, CONCURRENCY, async (index) => {
      const response = await httpRequest(`${GATEWAY}${WORK_ORDERS}/${workOrders[index].id}`, {
        method: 'DELETE',
        token: officer.accessToken,
        body: { version: workOrders[index].version },
        timeoutMs: 60_000,
      });
      return { status: response.status, durationMs: response.durationMs };
    });
    const metrics = buildStressMetrics(CONCURRENCY, samples, wallClockMs);
    await writeReport('revoke', metrics);

    assert.equal(metrics.failed, 0, `no revoke may fail, saw ${JSON.stringify(metrics.statusCounts)}`);
    assert.equal(metrics.successful, TOTAL);

    // Marketing must have cleared every link, so the quotation is free again.
    await waitFor(async () => {
      const rows = await query<{ count: string }>(
        'marketing',
        'SELECT COUNT(*)::text AS count FROM quotations WHERE has_work_order = true',
      );
      return Number(rows[0]?.count ?? 0) === 0;
    }, { timeoutMs: 60_000, label: 'the Marketing quotation link to be cleared' });
  });

  test('MIXED READ LOAD: concurrent reads never produce a server error', async () => {
    const TOTAL = 120;
    const CONCURRENCY = 20;

    // The read path is measured on its own, so it cannot be distorted by the
    // writes of an earlier scenario.
    const { samples, wallClockMs } = await runLoad(TOTAL, CONCURRENCY, async () => {
      const response = await httpRequest(`${GATEWAY}${WORK_ORDERS}`, {
        token: officer.accessToken,
        timeoutMs: 60_000,
      });
      return { status: response.status, durationMs: response.durationMs };
    });
    const metrics = buildStressMetrics(CONCURRENCY, samples, wallClockMs);
    await writeReport('read-list', metrics);

    assert.equal(metrics.failed, 0, `no request may fail, saw ${JSON.stringify(metrics.statusCounts)}`);
    for (const [status, count] of Object.entries(metrics.statusCounts)) {
      assert.ok(Number(status) < 500, `no 5xx is acceptable, saw ${count} responses with status ${status}`);
    }
  });
});
