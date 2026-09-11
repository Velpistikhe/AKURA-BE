const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { prisma } = require('../dist/config/db.js');
const routes = require('../dist/modules/companies/company.routes.js').default;

async function main() {
  const branch = randomUUID(), actor = randomUUID();
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { res.locals.authUser = { id: actor, firstName: 'History', lastName: 'Test', officeBranchId: req.headers['x-branch'] || branch }; next(); });
  app.use('/companies', routes);
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = async (method, path, body, expected = 200, officeBranchId = branch) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/companies${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-branch': officeBranchId }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await res.json(); assert.equal(res.status, expected, JSON.stringify(result)); return result.data;
  };
  try {
    const input = { name: randomUUID(), type: 'PT', address: 'Jakarta', npwp: ' 0012345678901234 ' };
    for (const npwp of [undefined, null, '', '   ', 123]) await request('POST', '', { ...input, npwp }, 400);
    const company = await request('POST', '', input, 201), path = `/${company.id}`;
    assert.equal(company.npwp, input.npwp.trim()); assert.equal(company.version, 0);
    const staff = await prisma.companyStaff.create({ data: { companyId: company.id, name: 'Contact', normalizeName: 'contact', title: 'mr' } });
    const contract = await prisma.companyContract.create({ data: { companyId: company.id, effectiveFrom: new Date('2020-01-01'), status: 'ACTIVE', createdById: actor, createdByName: 'Test' } });
    const original = (await request('GET', path + '/history')).history[0];
    assert.equal(original.action, 'CREATE'); assert.equal(original.createdById, actor); assert.equal(original.createdByName, 'History Test');
    for (const npwp of [null, '', '   ', 123]) await request('PATCH', path, { version: 0, npwp }, 400);
    await request('GET', path + '/history', undefined, 404, randomUUID());
    await request('PATCH', path, { version: 0, name: 'Foreign' }, 404, randomUUID());
    await request('GET', path + '/history?limit=101', undefined, 400);
    const updated = await request('PATCH', path, { version: 0, name: randomUUID(), npwp: '0099999999999999' });
    assert.equal(updated.id, company.id); assert.equal(updated.createdAt, company.createdAt); assert.equal(updated.createdById, actor);
    assert.equal(updated.updatedById, actor); assert.equal(updated.version, 1);
    assert.equal(updated.contract.id, contract.id);
    assert.deepEqual(await prisma.companyStaff.findUniqueOrThrow({ where: { id: staff.id } }), staff);
    assert.deepEqual(await prisma.companyContract.findUniqueOrThrow({ where: { id: contract.id } }), contract);
    assert.equal(await prisma.company.count({ where: { officeBranchId: branch } }), 1);
    await request('PATCH', path, { version: 0, name: 'Stale' }, 409);
    const race = await Promise.allSettled([1, 2].map(n => request('PATCH', path, { version: 1, address: `Address ${n}` })));
    assert.equal(race.filter(r => r.status === 'fulfilled').length, 1);
    let current = await request('GET', path);
    assert.equal(current.version, 2); assert.equal(current.npwp, updated.npwp);
    assert.equal((await request('GET', path + '/history')).pagination.total, 3);
    assert.deepEqual((await request('GET', path + '/history?page=3&limit=1')).history[0], original);
    // A failed history insert must roll back the profile change as well.
    const blocker = await prisma.companyHistory.create({ data: { companyId: company.id, version: 3, action: 'TEST', snapshot: {}, createdById: actor, createdByName: 'History Test' } });
    await request('PATCH', path, { version: 2, address: 'Must rollback' }, 500);
    assert.deepEqual(await request('GET', path), current);
    await prisma.companyHistory.delete({ where: { id: blocker.id } });
    const deleted = await request('DELETE', path, { version: 2 }); assert.equal(deleted.version, 3); assert.equal(deleted.revoked, true);
    await request('GET', path, undefined, 404); await request('DELETE', path, { version: 2 }, 409);
    const history = await request('GET', path + '/history');
    assert.deepEqual(history.history.map(h => h.version), [3, 2, 1, 0]);
    assert.equal(history.history[0].action, 'DEACTIVATE'); assert.equal(history.history[0].snapshot.revoked, true);
    assert.equal((await request('GET', '')).companies.length, 0);
    assert.equal((await prisma.companyStaff.findUniqueOrThrow({ where: { id: staff.id } })).revoked, true);
    console.log('PASS: NPWP validation, stable company/staff/contract IDs, CRUD, actor/version history, pagination, branch isolation, concurrency, rollback and deleted history.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await prisma.companyHistory.deleteMany({ where: { company: { officeBranchId: branch } } });
    await prisma.companyStaffHistory.deleteMany({ where: { companyStaff: { company: { officeBranchId: branch } } } });
    await prisma.company.deleteMany({ where: { officeBranchId: branch } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
