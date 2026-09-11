const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { prisma } = require('../dist/config/db.js');
const { quotationRepository: repository } = require('../dist/modules/quotations/quotation.repository.js');
const numbering = require('../dist/modules/quotations/quotation-number.js');

async function main() {
  const originalYear = numbering.quotationNumberYear;
  assert.equal(originalYear(new Date('2026-12-31T16:59:59Z')), 2026);
  assert.equal(originalYear(new Date('2026-12-31T17:00:00Z')), 2027);
  const branches = [randomUUID(), randomUUID()];
  const actor = { id: randomUUID(), name: 'Number test' };
  const fixtures = [];
  try {
    for (const branch of branches) {
      const company = await prisma.company.create({ data: {
        officeBranchId: branch, name: 'Number test', normalizeName: branch, type: 'PT', npwp: '0012345678901234', address: 'Jakarta',
        staffs: { create: { name: 'Contact', normalizeName: branch, title: 'mr' } },
      }, include: { staffs: true } });
      const service = await prisma.service.create({ data: {
        officeBranchId: branch, name: 'Inspection', type: 'TUBULAR',
        itemCatalog: { create: { officeBranchId: branch, name: 'Pipe', createdById: actor.id, createdByName: actor.name,
          sizes: { create: { size: 'Large', createdById: actor.id, createdByName: actor.name } } } },
      }, include: { itemCatalog: { include: { sizes: true } } } });
      fixtures.push({ branch, input: {
        date: '2020-01-01', inquiryMethod: 'EMAIL', inquiryDate: '2020-01-01', subject: 'Inspection', termOfPayment: '30 days', validity: '30 days',
        tax: 11, supplyAkura: 'Equipment', supplyCustomer: 'Access', location: 'Jakarta', accomplished: '7 days', deliveryReports: 'PDF',
        staffId: company.staffs[0].id, items: [{ itemSizeId: service.itemCatalog[0].sizes[0].id, quantity: '1', unitPrice: '10' }],
      } });
    }
    const [a, b] = fixtures;
    const create = f => repository.create(f.input, f.branch, actor);
    const counter = (branch, year) => prisma.quotationSequence.findUniqueOrThrow({ where: { officeBranchId_year: { officeBranchId: branch, year } } });
    numbering.quotationNumberYear = () => 2026;
    const invalid = { ...a.input, items: [{ ...a.input.items[0], itemSizeId: randomUUID() }] };
    await assert.rejects(repository.create(invalid, a.branch, actor), e => e.statusCode === 404);
    assert.equal(await prisma.quotationSequence.count({ where: { officeBranchId: a.branch } }), 0);
    const concurrent = await Promise.all(Array.from({ length: 5 }, () => create(a)));
    assert.deepEqual(concurrent.map(q => q.no).sort((x,y)=>x-y), [1,2,3,4,5]);
    assert(concurrent.every(q => q.numberYear === 2026));
    assert.equal((await counter(a.branch, 2026)).lastNumber, 5);
    assert.equal((await create(b)).no, 1);
    await assert.rejects(repository.create(invalid, a.branch, actor));
    assert.equal((await counter(a.branch, 2026)).lastNumber, 5);
    await repository.deactivate(concurrent[0].id, { version: 0 }, a.branch, actor);
    assert.equal((await create(a)).no, 6);
    // A held row lock must block same-branch numbering while another branch proceeds.
    let release, locked;
    const acquired = new Promise(resolve => { locked = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const holder = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT last_number FROM quotation_sequences WHERE office_branch_id = ${a.branch}::uuid AND year = 2026 FOR UPDATE`;
      locked(); await gate;
    }, { timeout: 10000 });
    await acquired;
    let completed = false;
    const blocked = create(a).then(q => { completed = true; return q; });
    try {
      assert.equal((await create(b)).no, 2);
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(completed, false);
    } finally { release(); await holder; }
    assert.equal((await blocked).no, 7);
    numbering.quotationNumberYear = () => 2027;
    const nextA = await create(a), nextB = await create(b);
    assert.equal(nextA.no, 1); assert.equal(nextB.no, 1);
    assert.equal(nextA.numberYear, 2027);
    assert.equal((await counter(a.branch, 2026)).lastNumber, 7);
    assert.equal((await counter(a.branch, 2027)).lastNumber, 1);
    await assert.rejects(repository.update(nextA.id, { version: 0, no: 10 }, a.branch, actor));
    const updated = await repository.update(nextA.id, { version: 0, date: '2030-01-01' }, a.branch, actor);
    assert.equal(updated.no, 1); assert.equal(updated.numberYear, 2027);
    const history = await repository.history(nextA.id, a.branch);
    assert(history.every(h => h.snapshot.no === 1 && h.snapshot.numberYear === 2027));
    console.log('PASS: first-use concurrency, branch independence, annual reset, Jakarta year boundary, row locking, rollback, no reuse after deletion, immutable numbering, and history.');
  } finally {
    numbering.quotationNumberYear = originalYear;
    const where = { officeBranchId: { in: branches } };
    await prisma.quotationHistory.deleteMany({ where: { quotation: where } });
    await prisma.quotationItem.deleteMany({ where: { quotation: where } });
    await prisma.quotation.deleteMany({ where });
    await prisma.quotationSequence.deleteMany({ where });
    await prisma.service.deleteMany({ where });
    await prisma.company.deleteMany({ where });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(()=>prisma.$disconnect());
