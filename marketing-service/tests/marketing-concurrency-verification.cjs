const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { prisma } = require('../dist/config/db.js');
const { companyRepository } = require('../dist/modules/companies/company.repository.js');
const { normalizeName } = require('../dist/utils/normalizeName.js');

const actor = () => ({ id: randomUUID(), name: 'Marketing concurrency test' });
const companyInput = (name, officeBranchId) => ({
  officeBranchId,
  name,
  normalizeName: normalizeName(name),
  npwp: '0012345678901234',
  type: 'PT',
  address: 'Jakarta',
  isSisterCompany: false,
});

async function runWithConcurrency(inputs, worker, concurrency = 8) {
  const results = new Array(inputs.length);
  let nextIndex = 0;
  const runWorker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= inputs.length) return;
      results[index] = await worker(inputs[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, runWorker));
  return results;
}

async function main() {
  const branch = randomUUID();
  const otherBranch = randomUUID();
  const createdCompanyIds = [];

  try {
    // Race condition: the branch lock and database unique key must allow one duplicate only.
    const duplicateName = `race-${randomUUID()}`;
    const duplicateResults = await Promise.allSettled([
      companyRepository.create(companyInput(duplicateName, branch), actor()),
      companyRepository.create(companyInput(duplicateName, branch), actor()),
    ]);
    const duplicateSuccesses = duplicateResults.filter(result => result.status === 'fulfilled');
    const duplicateFailures = duplicateResults.filter(result => result.status === 'rejected');
    assert.equal(duplicateSuccesses.length, 1, `duplicate race must have exactly one winner: ${duplicateResults.map(result => result.status === 'rejected' ? result.reason.message : 'success').join(' | ')}`);
    assert.equal(duplicateFailures.length, 1, 'duplicate race must reject exactly one request');
    assert.equal(duplicateFailures[0].reason.statusCode, 409);
    createdCompanyIds.push(duplicateSuccesses[0].value.id);

    // Stress test: concurrent writes in one branch and another branch must remain isolated.
    const stressInputs = Array.from({ length: 50 }, (_, index) => ({
      name: `stress-${index}-${randomUUID()}`,
      branch: index % 2 === 0 ? branch : otherBranch,
    }));
    const stressResults = await runWithConcurrency(stressInputs, input =>
      companyRepository.create(companyInput(input.name, input.branch), actor()),
      8,
    );
    createdCompanyIds.push(...stressResults.map(result => result.id));
    assert.equal(new Set(stressResults.map(result => result.id)).size, stressInputs.length);

    const branchRows = await prisma.company.count({ where: { officeBranchId: branch, revoked: false } });
    const otherBranchRows = await prisma.company.count({ where: { officeBranchId: otherBranch, revoked: false } });
    assert.equal(branchRows, 1 + stressInputs.filter(input => input.branch === branch).length);
    assert.equal(otherBranchRows, stressInputs.filter(input => input.branch === otherBranch).length);

    // Lost update: all writers use the same snapshot; optimistic locking permits one update only.
    const target = await prisma.company.findUniqueOrThrow({ where: { id: createdCompanyIds[0] } });
    const concurrentUpdates = await Promise.allSettled(
      Array.from({ length: 10 }, (_, index) => companyRepository.update(
        target.id,
        branch,
        { version: target.version, address: `Concurrent address ${index}` },
        actor(),
      )),
    );
    const updateSuccesses = concurrentUpdates.filter(result => result.status === 'fulfilled');
    const updateFailures = concurrentUpdates.filter(result => result.status === 'rejected');
    assert.equal(updateSuccesses.length, 1, 'lost update protection must allow one stale-version update');
    assert.equal(updateFailures.length, 9);
    for (const failure of updateFailures) assert.equal(failure.reason.statusCode, 409);

    const current = await prisma.company.findUniqueOrThrow({ where: { id: target.id } });
    assert.equal(current.version, target.version + 1);
    assert.equal(current.address, updateSuccesses[0].value.address);

    // Audit trail: CREATE plus the single successful UPDATE, with unique ordered versions and actor data.
    const history = await prisma.companyHistory.findMany({
      where: { companyId: target.id },
      orderBy: { version: 'asc' },
    });
    assert.deepEqual(history.map(row => row.version), [0, 1]);
    assert.deepEqual(history.map(row => row.action), ['CREATE', 'UPDATE']);
    assert.equal(history[0].snapshot.id, target.id);
    assert.equal(history[1].snapshot.version, 1);
    assert.equal(history[1].snapshot.address, current.address);
    assert(history.every(row => row.createdById && row.createdByName));

    // Branch ownership: the same company and its history are invisible from another branch.
    assert.equal(await prisma.company.count({ where: { id: target.id, officeBranchId: otherBranch } }), 0);
    assert.equal(await prisma.companyHistory.count({ where: { companyId: target.id, company: { officeBranchId: otherBranch } } }), 0);

    console.log('PASS: marketing stress, concurrency, race condition, lost update, and audit trail verification');
  } finally {
    // Test data is uniquely namespaced by generated branch IDs and can be removed safely.
    await prisma.companyHistory.deleteMany({ where: { companyId: { in: createdCompanyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: createdCompanyIds } } });
    await prisma.$disconnect();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
