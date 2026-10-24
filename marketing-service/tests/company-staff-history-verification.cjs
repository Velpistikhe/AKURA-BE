const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { prisma } = require('../dist/config/db.js');
const staffRoutes = require('../dist/modules/company-staff/company-staff.routes.js').default;
const companyRoutes = require('../dist/modules/companies/company.routes.js').default;

async function main() {
  const branch = randomUUID(), actor = randomUUID();
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { res.locals.authUser = { id: actor, firstName: 'Staff', lastName: 'History', officeBranchId: req.headers['x-branch'] || branch }; next(); });
  app.use('/company-staffs', staffRoutes); app.use('/companies', companyRoutes);
  app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = async (method, path, body, expected = 200, officeBranchId = branch) => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-branch': officeBranchId }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = await res.json(); assert.equal(res.status, expected, JSON.stringify(result)); return result.data;
  };
  try {
    const company = await request('POST', '/companies', { name: randomUUID(), type: 'PT', address: 'Jakarta', npwp: '123' }, 201);
    const create = () => request('POST', '/company-staffs', { companyId: company.id, name: randomUUID(), title: 'mr', email: 'old@example.com' }, 201);
    const staff = await create(), path = `/company-staffs/${staff.id}`;
    const original = (await request('GET', path + '/history')).history[0];
    assert.equal(original.version, 0); assert.equal(original.action, 'CREATE'); assert.equal(original.createdById, actor); assert.equal(original.createdByName, 'Staff History');
    assert.equal(original.snapshot.companyId, company.id);
    assert.deepEqual(original.snapshot.company, { id: company.id, name: company.name, type: company.type, version: company.version });
    const updated = await request('PATCH', path, { version: 0, name: randomUUID(), email: null });
    assert.equal(updated.id, staff.id); assert.equal(updated.version, 1);
    assert.equal(updated.createdAt, staff.createdAt); assert.equal(updated.createdById, actor); assert.equal(updated.updatedById, actor);
    const updateHistory = (await request('GET', path + '/history')).history[0];
    assert.equal(updateHistory.action, 'UPDATE'); assert.equal(updateHistory.snapshot.email, null);
    assert.deepEqual(updateHistory.snapshot.company, { id: company.id, name: company.name, type: company.type, version: company.version });
    const companyStaffHistory = await request('GET', `/companies/${company.id}/staff-history`);
    assert.equal(companyStaffHistory.companyId, company.id);
    assert.deepEqual(companyStaffHistory.history.map(entry => entry.companyStaffId), [staff.id, staff.id]);
    assert.deepEqual(companyStaffHistory.history.map(entry => entry.version).sort(), [0, 1]);
    await request('GET', `/companies/${company.id}/staff-history`, undefined, 404, randomUUID());
    await request('PATCH', path, { version: 0, name: 'Stale' }, 409);
    await request('GET', path + '/history', undefined, 404, randomUUID());
    await request('PATCH', path, { version: 1, name: 'Foreign' }, 404, randomUUID());
    for (const query of ['limit=101', 'page=0', 'unknown=1']) await request('GET', path + '/history?' + query, undefined, 400);
    const results = await Promise.allSettled([1, 2].map(n => request('PATCH', path, { version: 1, telp: `123${n}` })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    const current = await request('GET', path);
    assert.equal(current.version, 2);
    assert.deepEqual((await request('GET', path + '/history?page=3&limit=1')).history[0], original);
    const blocker = await prisma.companyStaffHistory.create({ data: { companyStaffId: staff.id, version: 3, action: 'TEST', snapshot: {}, createdById: actor, createdByName: 'Staff History' } });
    await request('PATCH', path, { version: 2, name: 'Must rollback' }, 500);
    assert.deepEqual(await request('GET', path), current);
    await request('DELETE', path, { version: 2 }, 500);
    assert.deepEqual(await request('GET', path), current);
    await request('DELETE', `/companies/${company.id}`, { version: 0 }, 404);
    assert.equal((await request('GET', `/companies/${company.id}`)).version, 0);
    assert.deepEqual(await request('GET', path), current);
    await prisma.companyStaffHistory.delete({ where: { id: blocker.id } });
    await request('DELETE', path, { version: 2 });
    await request('DELETE', path, { version: 3 }, 409);
    await request('GET', path, undefined, 404);
    const directHistory = await request('GET', path + '/history');
    assert.deepEqual(directHistory.history.map(h => h.version), [3, 2, 1, 0]);
    assert.equal(directHistory.history[0].action, 'DEACTIVATE'); assert.equal(directHistory.history[0].snapshot.revoked, true);
    const active = await create();
    await request('DELETE', `/companies/${company.id}`, { version: 0 }, 404);
    await request('DELETE', `/company-staffs/${active.id}`, { version: active.version });
    const cascade = await request('GET', `/company-staffs/${active.id}/history`);
    assert.deepEqual(cascade.history.map(h => h.version), [1, 0]);
    assert.equal(cascade.history[0].action, 'DEACTIVATE'); assert.equal(cascade.history[0].snapshot.revoked, true);
    assert.deepEqual(cascade.history[0].snapshot.company, { id: company.id, name: company.name, type: company.type, version: company.version });
    assert.equal(cascade.history[0].createdById, actor);
    assert.equal(cascade.history[0].createdByName, 'Staff History');
    assert.deepEqual(await request('GET', path + '/history'), directHistory);
    await request('GET', `/company-staffs/${active.id}/history`, undefined, 404, randomUUID());
    console.log('PASS: staff snapshots, actors, versions, pagination, branch isolation, concurrency, rollback, explicit deactivation, retained history and unsupported company deletion.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await prisma.companyStaffHistory.deleteMany({ where: { companyStaff: { company: { officeBranchId: branch } } } });
    await prisma.companyHistory.deleteMany({ where: { company: { officeBranchId: branch } } });
    await prisma.company.deleteMany({ where: { officeBranchId: branch } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
