const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const { prisma } = require('../dist/config/db.js');
async function main() {
  const branch = randomUUID(), actor = randomUUID();
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { res.locals.authUser = { id: actor, role: 'ADMIN', section: 'MARKETING', firstName: 'Contract', lastName: 'Test', officeBranchId: req.headers['x-branch'] || branch }; next(); });
  app.use('/companies', require('../dist/modules/companies/company.routes.js').default);
  app.use('/company-contracts', require('../dist/modules/contracts/contract.routes.js').default);
  app.use((_req, res) => res.status(404).json({ message: 'Route not found' }));
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const request = async (method, path, body, expected = 200, selectedBranch = branch) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { 'content-type': 'application/json', 'x-branch': selectedBranch }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const json = await response.json(); assert.equal(response.status, expected, JSON.stringify(json)); return json.data;
  };
  try {
    const expected = new Map();
    let activeCompany, activeContract;
    for (const state of ['none', 'current', 'future', 'expired', 'draft', 'terminated']) {
      const company = await request('POST', '/companies', { name: randomUUID(), type: 'PT', npwp: '123', address: 'Jakarta' }, 201);
      assert.equal(company.contract, null);
      let contract;
      if (state !== 'none') contract = await prisma.companyContract.create({ data: { companyId: company.id, contractNumber: state, contractDate: new Date('2000-01-01'),
        effectiveFrom: new Date(state === 'future' ? '2090-01-01' : '2000-01-01'), effectiveUntil: new Date(state === 'expired' ? '2001-01-01' : '2099-01-01'),
        status: state === 'draft' ? 'DRAFT' : state === 'terminated' ? 'TERMINATED' : 'APPROVED', createdById: actor,
      } });
      const detail = await request('GET', `/companies/${company.id}`);
      assert.equal(detail.contract?.id ?? null, state === 'current' ? contract.id : null);
      expected.set(company.id, detail.contract);
      if (state === 'current') { activeCompany = company; activeContract = contract; }
      if (contract) {
        const contractDetail = await request('GET', `/company-contracts/${contract.id}`);
        assert.match(contractDetail.effectiveFrom, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(contractDetail.hasList, false);
      }
    }
    const list = await request('GET', '/companies?limit=100');
    assert.equal(list.pagination.total, expected.size);
    for (const company of list.companies) assert.deepEqual(company.contract, expected.get(company.id));
    const foreign = randomUUID();
    assert.equal((await request('GET', '/companies', undefined, 200, foreign)).companies.length, 0);
    await request('GET', `/companies/${activeCompany.id}`, undefined, 404, foreign);
    await request('GET', `/company-contracts/${activeContract.id}`, undefined, 404, foreign);
    const renamed = await request('PATCH', `/companies/${activeCompany.id}`, { version: activeCompany.version, name: randomUUID() });
    assert.equal(renamed.id, activeCompany.id);
    assert.equal(renamed.contract.id, activeContract.id);
    const expired = await request('PATCH', `/company-contracts/${activeContract.id}`, { version: activeContract.version, contractNumber: activeContract.contractNumber, contractDate: '2000-01-01', effectiveFrom: '2000-01-01', effectiveUntil: '2001-01-01' });
    assert.equal(expired.version, activeContract.version + 1);
    assert.equal((await request('GET', `/companies/${activeCompany.id}`)).contract, null);
    await request('DELETE', `/companies/${activeCompany.id}`, { version: renamed.version }, 404);
    console.log('PASS: company contract presentation for current/future/expired/draft/terminated periods, date-only contract responses, stable company identity and branch isolation.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    const company = { officeBranchId: branch };
    await prisma.companyContractHistory.deleteMany({ where: { companyContract: { company } } });
    await prisma.companyHistory.deleteMany({ where: { company } });
    await prisma.company.deleteMany({ where: company });
    await prisma.catalogAuditLog.deleteMany({ where: { officeBranchId: branch } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
