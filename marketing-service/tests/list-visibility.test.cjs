const assert = require('node:assert/strict');
const { test } = require('node:test');
const express = require('express');
const { serviceRepository } = require('../dist/modules/services/service.repository.js');
const { quotationRepository } = require('../dist/modules/quotations/quotation.repository.js');
const { contractRepository } = require('../dist/modules/contracts/contract.repository.js');
const { contractPriceHistoryRepository } = require('../dist/modules/contract-prices/contract-price-history.repository.js');
const { restrictListVisibility } = require('../dist/utils/officeBranch.js');

test('list visibility uses authenticated role and does not mutate query', () => {
  const query = { isActive: false, page: 2, limit: 10 };
  assert.deepEqual(restrictListVisibility({ locals: { authUser: { role: 'USER' } } }, query), { ...query, isActive: true });
  assert.equal(query.isActive, false);
  assert.throws(() => restrictListVisibility({ locals: {} }, query), error => error.statusCode === 401);
});

test('all affected list routes enforce activity before repository pagination', async t => {
  const endpoints = [
    ['services', serviceRepository, 'list', '../dist/modules/services/service.routes.js'],
    ['quotations', quotationRepository, 'list', '../dist/modules/quotations/quotation.routes.js'],
    ['contracts', contractRepository, 'list', '../dist/modules/contracts/contract.routes.js'],
    ['prices', contractPriceHistoryRepository, 'listPrices', '../dist/modules/contract-prices/contract-price-history.routes.js'],
  ];
  const captured = new Map();
  const app = express();
  app.use((req, res, next) => {
    res.locals.authUser = { role: req.headers['x-test-role'], officeBranchId: 'test-branch' };
    next();
  });
  for (const [path, repository, method, route] of endpoints) {
    t.mock.method(repository, method, async (query, branch) => {
      captured.set(path, { query, branch });
      return {};
    });
    app.use(`/${path}`, require(route).default);
  }
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (const [path] of endpoints) {
    for (const role of ['USER', 'APP_MANAGER', 'ADMIN']) {
      for (const state of ['', '&isActive=false', '&isActive=true']) {
        const response = await fetch(`http://127.0.0.1:${server.address().port}/${path}?page=2&limit=5${state}`, {
          headers: { 'x-test-role': role },
        });
        await response.json();
        assert.equal(response.status, 200, `${path} ${role} ${state}`);
        const { query, branch } = captured.get(path);
        assert.equal(query.isActive, role !== 'ADMIN' ? true : state === '' ? undefined : state.endsWith('true'));
        assert.equal(branch, 'test-branch');
        assert.equal(query.page, 2);
        assert.equal(query.limit, 5);
      }
    }
  }
});
