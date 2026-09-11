const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { prisma } = require('../dist/config/db.js');
const companyRoutes = require('../dist/modules/companies/company.routes.js').default;
const contractRoutes = require('../dist/modules/contracts/contract.routes.js').default;

async function main() {
  const branch = randomUUID(), actor = randomUUID(), ids = [];
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    res.locals.authUser = { officeBranchId: req.headers['x-branch'] || branch, id: actor, firstName: 'Contract', lastName: 'Response', username: 'test' };
    next();
  });
  app.use('/companies', companyRoutes);
  app.use('/company-contracts', contractRoutes);
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = async (method, path, body, expected = 200, officeBranchId = branch) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-branch': officeBranchId },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = await response.json();
    assert.equal(response.status, expected, JSON.stringify(json));
    return json.data;
  };
  try {
    const expectedContracts = new Map();
    let activeCompany, activeContract;
    for (const state of ['none', 'current', 'open', 'future', 'expired', 'inactive']) {
      const company = await request('POST', '/companies', { name: randomUUID(), type: 'PT', npwp: '0012345678901234', address: 'Jakarta' }, 201);
      ids.push(company.id);
      assert.equal(company.contract, null);
      let contract = null;
      if (state !== 'none') {
        contract = await request('POST', '/company-contracts', {
          status: 'ACTIVE',
          companyId: company.id,
          effectiveFrom: state === 'future' ? '2090-01-01T00:00:00Z' : '2020-01-01T00:00:00Z',
          effectiveUntil: state === 'open' ? null : state === 'expired' ? '2021-01-01T00:00:00Z' : '2099-01-01T00:00:00Z',
        }, 201);
        assert.equal((await request('GET', `/company-contracts/${contract.id}`)).id, contract.id);
        assert.equal((await request('GET', `/company-contracts?companyId=${company.id}`)).contracts.length, 1);
        if (state === 'inactive') await request('DELETE', `/company-contracts/${contract.id}`, { version: contract.version });
      }
      const expected = state === 'current' || state === 'open' ? contract : null;
      expectedContracts.set(company.id, expected);
      const detail = await request('GET', `/companies/${company.id}`);
      assert.deepEqual(detail.contract, expected);
      assert.equal(Object.hasOwn(detail, 'contracts'), false);
      if (state === 'current') { activeCompany = company; activeContract = contract; }
    }
    const list = await request('GET', '/companies?limit=100');
    assert.equal(list.pagination.total, ids.length);
    for (const company of list.companies) assert.deepEqual(company.contract, expectedContracts.get(company.id));
    const otherBranch = randomUUID();
    assert.equal((await request('GET', '/companies', undefined, 200, otherBranch)).companies.length, 0);
    await request('GET', `/companies/${activeCompany.id}`, undefined, 404, otherBranch);
    await request('GET', `/company-contracts/${activeContract.id}`, undefined, 404, otherBranch);
    const expired = await request('PATCH', `/company-contracts/${activeContract.id}`, {
      version: activeContract.version, effectiveFrom: '2020-01-01T00:00:00Z', effectiveUntil: '2021-01-01T00:00:00Z',
    });
    assert.equal((await request('GET', `/companies/${activeCompany.id}`)).contract, null);
    await request('PATCH', `/company-contracts/${activeContract.id}`, {
      version: expired.version, effectiveFrom: '2020-01-01T00:00:00Z', effectiveUntil: null,
    });
    const revised = await request('PATCH', `/companies/${activeCompany.id}`, { version: activeCompany.version, name: randomUUID() });
    ids.push(revised.id);
    assert(revised.contract);
    assert.equal(revised.contract.companyId, revised.id);
    assert.equal(revised.id, activeCompany.id); assert.equal(revised.contract.id, activeContract.id);
    assert.deepEqual((await request('GET', `/companies/${revised.id}`)).contract, revised.contract);
    await request('GET', `/companies/${activeCompany.id}`);
    const deleted = await request('DELETE', `/companies/${revised.id}`, { version: revised.version });
    assert.equal(deleted.contract, null);
    console.log('PASS: company contract on list/detail/create/update/delete; current/open/future/expired/inactive periods, CRUD contracts, company revisions and branch isolation.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (ids.length) await prisma.companyHistory.deleteMany({ where: { companyId: { in: ids } } });
    if (ids.length) await prisma.company.deleteMany({ where: { id: { in: ids } } });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
