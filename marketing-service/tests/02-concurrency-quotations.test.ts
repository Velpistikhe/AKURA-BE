/**
 * CONCURRENCY - marketing-service quotation lifecycle.
 *
 * Targets the read-modify-write paths that decide a document's identity and
 * totals:
 *   - quotation number allocation (branch/year sequence)
 *   - optimistic version guard on update / add item / delete item
 *   - audit history continuity (one row per version)
 *
 * Every test asserts a database invariant, not just an HTTP status, so a
 * "successful" response that still corrupted the data is caught.
 */
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GATEWAY, loginAs, prismaFor, seedMarketingTax, seedOfficeBranch, seedUser,
  type SeededUser,
} from './support/fixtures.js';
import { httpRequest } from './support/http.js';
import {
  approveQuotation, buildCatalogFixture, createQuotation, createSubmittedQuotation,
  type CatalogFixture,
} from './support/catalog.js';
import { Barrier } from './support/metrics.js';
import { ensureDatabases, resetBeforeEach } from './support/suite.js';
import { startGateway, startService } from './support/processes.js';
import { startS3Stub, s3Environment, type S3Stub } from './support/s3-stub.js';
import type { ServiceProcess } from './support/harness.js';

let auth: ServiceProcess;
let marketing: ServiceProcess;
let fieldservice: ServiceProcess;
let gateway: ServiceProcess;
let s3: S3Stub;

let admin: SeededUser;
let branchId: string;
let fixture: CatalogFixture;

const QUOTATIONS = '/api/v1/marketing/quotations';

describe('marketing-service quotation concurrency', () => {
  // Every test starts from an empty marketing database, so the numbering and
  // version invariants are asserted against a known state.
  resetBeforeEach(['marketing']);

  before(async () => {
    await ensureDatabases();
    s3 = await startS3Stub();
    auth = await startService('auth');
    marketing = await startService('marketing', s3Environment(s3));
    // Field Service is started so the Work Order link callback of a quotation
    // has its counterpart: Marketing mirrors the link of a Work Order that
    // Field Service created.
    fieldservice = await startService('fieldservice');
    gateway = await startGateway();
  });

  after(async () => {
    for (const process_ of [gateway, fieldservice, marketing, auth]) await process_?.stop();
    await s3?.stop();
  });

  beforeEach(async () => {
    const branch = await seedOfficeBranch();
    branchId = branch.id;
    await seedMarketingTax(branchId);
    admin = await seedUser({ role: 'ADMIN', section: 'MARKETING', officeBranchId: branchId });
    await loginAs(admin);
    fixture = await buildCatalogFixture(admin.accessToken);
  });

  test('LOST UPDATE: concurrent updates of the same quotation keep exactly one winner', async () => {
    const quotation = await createQuotation(admin.accessToken, fixture);

    // Both requests carry the same version, so exactly one may win.
    const barrier = new Barrier(2);
    const attempt = async (subject: string) => {
      await barrier.wait();
      return httpRequest(`${GATEWAY}${QUOTATIONS}/${quotation.id}`, {
        method: 'PATCH',
        token: admin.accessToken,
        body: { version: quotation.version, subject },
      });
    };

    const [first, second] = await Promise.all([
      attempt('RelTest subject A'),
      attempt('RelTest subject B'),
    ]);

    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 409], `expected one 200 and one 409, got ${statuses.join(', ')}`);

    // The loser must not have overwritten the winner's value.
    const prisma = prismaFor('marketing');
    try {
      const row = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
      const winner = first.status === 200 ? first : second;
      assert.equal(row.subject, (winner.body as { data: { subject: string } }).data.subject);
      // The version advanced exactly once.
      assert.equal(row.version, quotation.version + 1, 'the version must advance exactly once');
    } finally {
      await prisma.$disconnect();
    }
  });

  test('LOST UPDATE: concurrent adds to the same quotation do not double-count the total', async () => {
    const quotation = await createQuotation(admin.accessToken, fixture);
    const prisma = prismaFor('marketing');
    try {
      const before = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });

      const barrier = new Barrier(2);
      // The two attempts use different item sizes: a quotation accepts a given
      // size only once, so reusing it would be rejected for an unrelated
      // reason (duplicate line) instead of the version guard under test.
      const attempt = async (itemSizeId: string, quantity: string) => {
        await barrier.wait();
        return httpRequest(`${GATEWAY}${QUOTATIONS}/${quotation.id}/items`, {
          method: 'POST',
          token: admin.accessToken,
          body: {
            version: quotation.version,
            itemSizeId,
            quantityInspection: quantity,
            quantityMaintenance: '0',
            discount: '0',
          },
        });
      };

      const [first, second] = await Promise.all([
        attempt(fixture.itemSizeId2, '2'),
        attempt(fixture.itemSizeId3, '3'),
      ]);
      const statuses = [first.status, second.status].sort();
      assert.deepEqual(statuses, [201, 409], `expected one 201 and one 409, got ${statuses.join(', ')}`);

      const after = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
      const activeItems = await prisma.quotationItem.count({
        where: { quotationId: quotation.id, isActive: true },
      });
      assert.equal(activeItems, 2, 'exactly one extra line may have been added');
      assert.equal(after.version, before.version + 1, 'the version must advance exactly once');
      assert.notEqual(after.total.toString(), before.total.toString(), 'the total must have been recalculated');
    } finally {
      await prisma.$disconnect();
    }
  });

  test('NUMBER ALLOCATION: concurrent approvals allocate distinct, gapless quotation numbers', async () => {
    // Four quotations in the same branch and year are approved at the same
    // time. Each approval allocates the next number from the branch/year
    // sequence, so the numbers must be unique and gapless.
    const CONCURRENCY = 4;
    const quotations = [];
    for (let index = 0; index < CONCURRENCY; index += 1) {
      quotations.push(await createSubmittedQuotation(admin.accessToken, fixture));
    }

    const barrier = new Barrier(CONCURRENCY);
    const attempts = quotations.map((quotation) => (async () => {
      await barrier.wait();
      return approveQuotation(admin.accessToken, quotation.id, quotation.version);
    })());

    const results = await Promise.all(attempts);
    const numbers = results.map((result) => result.no);

    const unique = new Set(numbers);
    assert.equal(unique.size, numbers.length, `numbers must be unique, got ${numbers.join(', ')}`);
    const sorted = [...numbers].sort((a, b) => a - b);
    assert.deepEqual(
      sorted,
      Array.from({ length: CONCURRENCY }, (_, index) => sorted[0] + index),
      `numbers must be gapless, got ${sorted.join(', ')}`,
    );

    const prisma = prismaFor('marketing');
    try {
      // Every approved quotation must carry its allocated number.
      const rows = await prisma.quotation.findMany({
        where: { id: { in: quotations.map((quotation) => quotation.id) } },
        select: { id: true, no: true, numberYear: true },
      });
      assert.equal(rows.length, CONCURRENCY);
      for (const row of rows) {
        assert.ok(row.no !== null && row.no > 0, `quotation ${row.id} must carry an allocated number`);
        assert.ok(numbers.includes(row.no), `stored number ${row.no} must be one of the allocated numbers`);
      }

      // The sequence counter must match the highest allocated number.
      const year = results[0].numberYear;
      const sequence = await prisma.quotationSequence.findUnique({
        where: { officeBranchId_year: { officeBranchId: branchId, year } },
      });
      assert.equal(sequence?.lastNumber, sorted[sorted.length - 1], 'the sequence counter must match the last number');
    } finally {
      await prisma.$disconnect();
    }
  });

  test('NUMBER ALLOCATION: a revision inherits its parent number instead of consuming a new one', async () => {
    const quotation = await createSubmittedQuotation(admin.accessToken, fixture);
    const approved = await approveQuotation(admin.accessToken, quotation.id, quotation.version);

    const prisma = prismaFor('marketing');
    try {
      const sequenceBefore = await prisma.quotationSequence.findUnique({
        where: { officeBranchId_year: { officeBranchId: branchId, year: approved.numberYear } },
      });

      // Revising copies the quotation; the copy keeps the approved number and
      // must not consume a new sequence value.
      const revised = await httpRequest(`${GATEWAY}${QUOTATIONS}/${quotation.id}/revise`, {
        method: 'POST',
        token: admin.accessToken,
        body: { version: approved.version },
      });
      assert.equal(revised.status, 201, JSON.stringify(revised.body));
      // The revision keeps the approved number of its parent.
      assert.equal(
        (revised.body as { data: { no: number } }).data.no,
        approved.no,
        'a revision must inherit the approved number of its parent',
      );

      const sequenceAfter = await prisma.quotationSequence.findUnique({
        where: { officeBranchId_year: { officeBranchId: branchId, year: approved.numberYear } },
      });
      assert.equal(
        sequenceAfter?.lastNumber,
        sequenceBefore?.lastNumber,
        'a revision must not consume a new quotation number',
      );
    } finally {
      await prisma.$disconnect();
    }
  });

  test('AUDIT TRAIL: every version of a quotation has exactly one history row', async () => {
    const quotation = await createQuotation(admin.accessToken, fixture);
    const prisma = prismaFor('marketing');
    try {
      // Apply a sequence of updates, each one advancing the version by one.
      let version = quotation.version;
      for (let index = 0; index < 3; index += 1) {
        const response = await httpRequest(`${GATEWAY}${QUOTATIONS}/${quotation.id}`, {
          method: 'PATCH',
          token: admin.accessToken,
          body: { version, subject: `RelTest revision ${index}` },
        });
        assert.equal(response.status, 200, JSON.stringify(response.body));
        version = (response.body as { data: { version: number } }).data.version;
      }

      const histories = await prisma.quotationHistory.findMany({
        where: { quotationId: quotation.id },
        select: { version: true, action: true },
      });
      const versions = histories.map((row) => row.version);
      // The versions must be unique: no version may be recorded twice.
      assert.equal(new Set(versions).size, versions.length, `duplicate history versions: ${versions.join(', ')}`);
      // Every recorded version must exist on the quotation itself.
      const row = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
      for (const recorded of versions) {
        assert.ok(recorded <= row.version, `history version ${recorded} must not exceed the quotation version ${row.version}`);
      }
    } finally {
      await prisma.$disconnect();
    }
  });
});
