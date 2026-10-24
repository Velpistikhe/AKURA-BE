const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { writeFileSync } = require('node:fs');
const express = require('express');
const { openApiDocument, prefix, assertInventory, validate } = require('./swagger-contract.cjs');

async function main() {
  const routes = assertInventory();
  const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
  const keys = await generateKeyPair('RS256');
  const publicKey = { ...await exportJWK(keys.publicKey), kid: 'marketing-contract-test', alg: 'RS256', use: 'sig' };
  const branch = randomUUID(), foreignBranch = randomUUID();
  const users = new Map();
  const boundary = express();
  boundary.use(express.json());
  // Only external dependencies are substituted. Marketing's gateway guard,
  // RS256 verification, authorization, routers and database execute unchanged.
  boundary.get('/api/v1/auth/.well-known/jwks.json', (_req, res) => res.json({ keys: [publicKey] }));
  boundary.get('/api/v1/auth/me', (req, res) => {
    const user = users.get(req.headers.authorization?.slice(7));
    res.status(user ? 200 : 401).json({ data: user });
  });
  boundary.get('/api/v1/auth/users/marketing-contacts', (_req, res) => res.json({ data: { contacts: [] } }));
  boundary.get('/api/v1/fieldservice/work-orders/by-quotation/:id', (_req, res) => res.json({ data: null }));
  boundary.post('/api/v1/fieldservice/work-orders', (req, res) => res.status(201).json({ data: {
    id: randomUUID(), quotationId: req.body.quotationId, officeBranchId: branch, revoked: false, number: 'WO-CONTRACT-TEST', status: 'DRAFT', version: 0,
  } }));
  const listen = app => new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const dependencyServer = await listen(boundary);
  process.env.API_GATEWAY_URL = `http://127.0.0.1:${dependencyServer.address().port}`;
  process.env.DIRECT_MFE_ACCESS = 'false';
  process.env.TAX_SYNC_SECRET = randomUUID();
  process.env.USER_SYNC_SECRET = randomUUID();
  process.env.WORK_ORDER_SYNC_SECRET = randomUUID();
  const { env } = require('../dist/config/env.js');
  const { prisma } = require('../dist/config/db.js');
  const { quotationStorage } = require('../dist/modules/quotations/quotation-storage.js');
  const stored = new Map();
  quotationStorage.bucket = () => 'contract-test';
  quotationStorage.upload = async (_bucket, key, body) => { stored.set(key, body); };
  quotationStorage.remove = async (_bucket, key) => { stored.delete(key); };
  quotationStorage.downloadUrl = async (_bucket, key) => ({ url: `https://storage.example/${key}`, expiresAt: new Date(Date.now() + 900000).toISOString() });
  const server = await listen(require('../dist/app.js').default);
  const url = `http://127.0.0.1:${server.address().port}`;
  const checks = [], schemaErrors = [], coverage = new Map();
  const identity = async (overrides = {}) => {
    const user = { id: randomUUID(), username: 'contract', firstName: 'Contract', lastName: 'Test', isActive: true, role: 'ADMIN', section: 'MARKETING', officeBranchId: branch, ...overrides };
    const token = await new SignJWT({ type: 'access', role: user.role, officeBranchId: user.officeBranchId })
      .setProtectedHeader({ alg: 'RS256', kid: publicKey.kid }).setSubject(user.id).setIssuer(env.JWT_ISSUER).setAudience(env.JWT_AUDIENCE).setIssuedAt().setExpirationTime('10m').sign(keys.privateKey);
    users.set(token, user);
    return { token, user };
  };
  const actor = await identity(), other = await identity({ officeBranchId: foreignBranch });
  const member = await identity({ role: 'USER' });
  const finance = await identity({ role: 'USER', section: 'FINANCE' });
  async function request(method, routePath, expected, json, credential = actor, extra = {}) {
    const route = routes.find(item => item.method === method && new RegExp(`^${item.path.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(routePath.split('?')[0]));
    assert.ok(route, `Unknown test route ${method} ${routePath}`);
    const response = await fetch(`${url}${routePath}`, {
      method, headers: { 'x-gateway-secret': env.GATEWAY_SECRET, ...(credential ? {
        authorization: `Bearer ${credential.token}`, 'x-user-id': credential.user.id, 'x-user-role': credential.user.role,
        ...(credential.user.officeBranchId ? { 'x-office-branch-id': credential.user.officeBranchId } : {}),
      } : {}), ...(json === undefined || json instanceof FormData ? {} : { 'content-type': 'application/json' }), ...extra },
      ...(json === undefined ? {} : { body: json instanceof FormData ? json : JSON.stringify(json) }), signal: AbortSignal.timeout(20000),
    });
    const mediaType = response.headers.get('content-type')?.split(';')[0];
    const binary = mediaType !== 'application/json';
    const body = binary ? Buffer.from(await response.arrayBuffer()) : await response.json();
    assert.equal(response.status, expected, `${method} ${routePath}: ${binary ? mediaType : JSON.stringify(body)}`);
    const operation = openApiDocument.paths[`${prefix}${route.path}`][method.toLowerCase()];
    if (expected < 300 && json !== undefined && !(json instanceof FormData)) {
      const inputSchema = operation.requestBody?.content?.['application/json']?.schema;
      if (inputSchema) {
        try { validate(json, inputSchema, `${method} ${route.path} request`); }
        catch (error) { schemaErrors.push(error.message); }
      }
    }
    const documented = operation.responses[expected];
    assert.ok(documented, `${method} ${route.path}: undocumented response ${expected}`);
    if (documented.content) {
      assert.ok(documented.content[mediaType], `${method} ${route.path}: undocumented media type ${mediaType}`);
      if (!binary) {
        try { validate(body, documented.content[mediaType].schema, `${method} ${route.path} ${expected}`); }
        catch (error) { schemaErrors.push(error.message); }
      }
    }
    const key = `${method} ${route.path}`;
    coverage.set(key, [...new Set([...(coverage.get(key) || []), expected])]);
    checks.push({ method, path: route.path, status: expected });
    return body?.data ?? body;
  }
  try {
    assert.equal((await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) })).status, 403, 'direct service access requires the gateway secret');
    for (const route of routes) {
      const routePath = route.path.replace(/\{[^}]+\}/g, 'invalid');
      if (route.path === '/health') await request(route.method, routePath, 200, undefined, null);
      else if (route.path.startsWith('/internal/')) {
        await request(route.method, routePath, 403, {}, null);
        const header = route.path.includes('/taxes/') ? 'x-tax-sync-secret' : route.path.includes('/users/') ? 'x-user-sync-secret' : 'x-work-order-sync-secret';
        const secret = header.includes('tax') ? env.TAX_SYNC_SECRET : header.includes('user') ? env.USER_SYNC_SECRET : env.WORK_ORDER_SYNC_SECRET;
        await request(route.method, routePath, 400, {}, null, { [header]: secret });
      } else {
        await request(route.method, routePath, 401, undefined, null);
        if (route.path.includes('{')) await request(route.method, routePath, 400, route.method === 'GET' ? undefined : {});
        else if (route.method !== 'GET') await request(route.method, routePath, 400, {});
        else if (route.path !== '/quotation-references') await request('GET', `${routePath}?page=0`, 400);
      }
    }
    await request('GET', '/companies', 401, undefined, actor, { authorization: 'Bearer invalid' });
    await request('GET', '/companies', 401, undefined, actor, { 'x-user-id': randomUUID() });
    await request('GET', '/companies', 403, undefined, finance);
    await request('GET', '/companies', 403, undefined, await identity({ officeBranchId: null }));
    await request('GET', '/companies', 403, undefined, await identity({ isActive: false }));
    const company = await request('POST', '/companies', 201, { name: `Contract ${branch}`, npwp: '0012345678901234', type: 'PT', address: 'Jakarta' });
    const standalone = await request('POST', '/items', 201, { name: 'Standalone', uom: 'PCS', inspectionScopes: ['Visual'], maintenanceScopes: ['Cleaning'] });
    await request('GET', `/items/${standalone.id}`, 200);
    await request('DELETE', `/items/${standalone.id}`, 200, { version: standalone.version });
    await request('GET', `/companies/${company.id}`, 200);
    await request('GET', `/companies/${company.id}`, 404, undefined, other);
    const updated = await request('PATCH', `/companies/${company.id}`, 200, { version: company.version, address: 'Bandung' });
    await request('PATCH', `/companies/${company.id}`, 409, { version: company.version, address: 'Stale' });
    await request('GET', `/companies/${company.id}/history`, 200);
    await request('GET', `/companies/${company.id}/staff-history`, 200);
    const staff = await request('POST', '/company-staffs', 201, { companyId: company.id, name: 'Contract Contact', title: 'mr' });
    await request('GET', `/company-staffs/${staff.id}`, 200);
    await request('GET', `/company-staffs/${staff.id}`, 404, undefined, other);
    await request('PATCH', `/company-staffs/${staff.id}`, 200, { version: staff.version, email: 'contact@example.com' });
    await request('GET', `/company-staffs/${staff.id}/history`, 200);
    const service = await request('POST', '/services', 201, { name: `Contract ${branch}`, type: 'TUBULAR', hasMaintenance: true, maintenanceScopes: ['Repair'], inspectionScopes: ['Inspect'] });
    const scope = await request('POST', `/services/${service.id}/inspection/scopes`, 201, { inspectionScope: 'Added inspection' });
    const maintenance = await request('POST', `/services/${service.id}/maintenance/scopes`, 201, { scope: 'Added maintenance' });
    await request('DELETE', `/services/${service.id}/inspection/scopes/${scope.id}`, 200);
    await request('DELETE', `/services/${service.id}/maintenance/scopes/${maintenance.id}`, 200);
    const currentService = await prisma.service.findUniqueOrThrow({ where: { id: service.id } });
    await request('PATCH', `/services/${service.id}`, 200, { version: currentService.version, name: 'Updated service' });
    await request('GET', `/services/${service.id}`, 200);
    await request('GET', `/services/${service.id}`, 404, undefined, other);
    await request('GET', `/services/${service.id}/history`, 200);
    const item = await request('POST', '/items', 201, { serviceId: service.id, name: 'Pipe', uom: 'JOINT', sizes: [{ size: 'Large', priceServicePrimary: '100', priceMaintenancePrimary: '20', priceMaintenanceSisterCompany: '10' }] });
    const itemRow = await prisma.item.findUniqueOrThrow({ where: { id: item.id }, include: { sizes: true } });
    const size = itemRow.sizes[0];
    await request('GET', `/items/${itemRow.id}`, 200);
    await request('GET', `/items/${itemRow.id}`, 404, undefined, other);
    await request('GET', `/items/sizes/${size.id}`, 200);
    await request('GET', `/items/${itemRow.id}/history`, 200);
    await request('GET', `/items/sizes/${size.id}/history`, 200);
    await request('GET', `/items/sizes/${size.id}/price/history`, 200);
    const price = await prisma.itemPrice.findUniqueOrThrow({ where: { itemSizeId: size.id } });
    await request('PATCH', `/items/sizes/${size.id}/price`, 200, { version: price.version, priceServicePrimary: '110' });
    const nextSize = await request('POST', '/items/sizes', 201, { itemId: itemRow.id, itemVersion: (await prisma.item.findUniqueOrThrow({ where: { id: itemRow.id } })).version, size: 'Small' });
    const small = await prisma.itemSize.findFirstOrThrow({ where: { itemId: itemRow.id, size: 'Small' } });
    await request('POST', `/items/sizes/${small.id}/price`, 201, { priceServicePrimary: '50', priceMaintenancePrimary: '10', priceMaintenanceSisterCompany: '5' });
    await request('GET', `/items/sizes/prices?companyId=${company.id}`, 200);
    await request('GET', '/items/sizes/export', 200);
    let contract = await request('POST', '/company-contracts', 201, { companyId: company.id, contractNumber: `CONTRACT-${branch}`, contractDate: '2026-01-01', effectiveFrom: '2026-01-01', effectiveUntil: '2099-12-31' });
    let contractPrice = await request('POST', `/items/sizes/${size.id}/contract-prices`, 201, { contractId: contract.id, priceService: '90', priceMaintenance: '10' });
    contract = await prisma.companyContract.findUniqueOrThrow({ where: { id: contract.id } });
    contract = await request('POST', `/company-contracts/${contract.id}/submit`, 200, { version: contract.version });
    contract = await request('POST', `/company-contracts/${contract.id}/reject`, 200, { version: contract.version });
    contract = await request('PATCH', `/company-contracts/${contract.id}`, 200, { version: contract.version, contractNumber: `UPDATED-${branch}`, contractDate: '2026-01-01', effectiveFrom: '2026-01-01', effectiveUntil: '2099-12-31' });
    contract = await request('POST', `/company-contracts/${contract.id}/submit`, 200, { version: contract.version });
    contract = await request('POST', `/company-contracts/${contract.id}/approve`, 200, { version: contract.version });
    await request('GET', `/company-contracts/${contract.id}`, 200);
    await request('GET', `/company-contracts/${contract.id}/history`, 200);
    await request('GET', `/contract-references/${contract.id}`, 200, undefined, finance);
    await request('GET', `/company-contract-references/${company.id}`, 200, undefined, finance);
    await request('GET', `/items/sizes/contract-price-options/${contract.id}`, 200);
    contractPrice = await request('PATCH', `/items/contract-prices/${contractPrice.id}`, 200, { version: contractPrice.version, priceService: '95' });
    await request('GET', `/company-contract-prices/${contractPrice.id}/history`, 200);
    await request('DELETE', `/items/contract-prices/${contractPrice.id}`, 200, { version: contractPrice.version });
    const workbook = await request('GET', `/items/sizes/export?itemId=${itemRow.id}&size=Small`, 200);
    const importBody = new FormData();
    importBody.set('file', new Blob([workbook]), 'prices.xlsx');
    importBody.set('companyId', company.id);
    importBody.set('version', String((await prisma.companyContract.findUniqueOrThrow({ where: { id: contract.id } })).version));
    await request('POST', `/company-contracts/${contract.id}/prices/import`, 201, importBody);
    const contractCurrent = await prisma.companyContract.findUniqueOrThrow({ where: { id: contract.id } });
    const contractRevision = await request('POST', `/company-contracts/${contract.id}/revise`, 201, { version: contractCurrent.version, contractNumber: `REVISION-${branch}`, contractDate: '2026-01-01', effectiveFrom: '2027-01-01', effectiveUntil: '2099-12-31' });
    await request('DELETE', `/company-contracts/${contractRevision.id}`, 200, { version: contractRevision.version });
    for (const routePath of ['/companies', '/company-staffs', '/services', '/items', '/items/sizes', '/company-contracts', '/company-contract-prices', '/quotations', '/quotation-references']) await request('GET', routePath, 200);
    await request('GET', '/quotation-references', 200, undefined, finance);
    const quotationInput = { jobStart: '2026-11-01', inquiryMethod: 'EMAIL', inquiryDate: '2026-10-01', subject: 'Inspection', termOfPayment: '30 days', validity: '30 days', supplyAkura: 'Equipment', supplyCustomer: 'Access', location: 'Jakarta', accomplished: '7 days', deliveryReports: 'PDF', deliveryInvoice: 'Email', staffId: staff.id, items: [{ itemSizeId: size.id, quantityInspection: '2', quantityMaintenance: '1' }] };
    await request('POST', '/internal/taxes/events', 200, { eventId: randomUUID(), officeBranchId: branch, version: 1, taxes: [{ id: randomUUID(), officeBranchId: branch, percentage: '11', effectiveFrom: '2000-01-01T00:00:00.000Z', effectiveUntil: null, updatedAt: new Date().toISOString() }] }, null, { 'x-tax-sync-secret': env.TAX_SYNC_SECRET });
    let quotation = await request('POST', '/quotations', 201, quotationInput);
    await request('GET', `/quotations/${quotation.id}`, 200);
    await request('GET', `/quotations/${quotation.id}`, 404, undefined, other);
    await request('GET', `/quotation-references/${quotation.id}`, 200, undefined, finance);
    await request('GET', `/quotations/${quotation.id}/history`, 200);
    quotation = await request('PATCH', `/quotations/${quotation.id}`, 200, { version: quotation.version, subject: 'Updated inspection' });
    quotation = await request('POST', `/quotations/${quotation.id}/items`, 201, { version: quotation.version, itemSizeId: small.id, quantityInspection: '1' });
    const quotationItem = await prisma.quotationItem.findFirstOrThrow({ where: { quotationId: quotation.id, itemSizeId: small.id } });
    quotation = await request('DELETE', `/quotations/${quotation.id}/items/${quotationItem.id}`, 200, { quotationVersion: quotation.version, itemVersion: quotationItem.version });
    await request('GET', `/quotations/${quotation.id}/pdf`, 200);
    quotation = await request('POST', `/quotations/${quotation.id}/submit`, 200, { version: quotation.version }, member);
    quotation = await request('POST', `/quotations/${quotation.id}/reject`, 200, { version: quotation.version });
    quotation = await request('POST', `/quotations/${quotation.id}/submit`, 200, { version: quotation.version });
    quotation = await request('POST', `/quotations/${quotation.id}/approve`, 200, { version: quotation.version });
    assert.ok(stored.size > 0);
    const quoteRevision = await request('POST', `/quotations/${quotation.id}/revise`, 201, { version: quotation.version });
    await request('DELETE', `/quotations/${quoteRevision.id}`, 200, { version: quoteRevision.version });
    quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
    const workOrder = await request('POST', `/quotations/${quotation.id}/work-orders`, 201, { quotationId: quotation.id, startDate: '2026-11-01', endDate: '2026-11-02', inspectors: [{ userId: randomUUID(), name: 'Inspector Test' }] });
    const event = { workOrderId: workOrder.id, quotationId: quotation.id, officeBranchId: branch, revoked: false, workOrderSnapshot: { number: workOrder.number, status: workOrder.status } };
    await request('POST', '/internal/work-orders/events', 200, event, null, { 'x-work-order-sync-secret': env.WORK_ORDER_SYNC_SECRET });
    await request('POST', '/internal/work-orders/events', 200, { ...event, revoked: true }, null, { 'x-work-order-sync-secret': env.WORK_ORDER_SYNC_SECRET });
    quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: quotation.id } });
    await request('DELETE', `/quotations/${quotation.id}`, 200, { version: quotation.version });
    const smallCurrent = await prisma.itemSize.findUniqueOrThrow({ where: { id: small.id } });
    await request('DELETE', `/items/sizes/${small.id}`, 200, { version: smallCurrent.version });
    await request('POST', `/company-contracts/${contract.id}/terminate`, 200, { version: (await prisma.companyContract.findUniqueOrThrow({ where: { id: contract.id } })).version, terminatedAt: '2026-12-31' });
    await request('POST', '/internal/taxes/events', 200, { eventId: randomUUID(), officeBranchId: branch, version: 2, taxes: [] }, null, { 'x-tax-sync-secret': env.TAX_SYNC_SECRET });
    const userEvent = { eventId: randomUUID(), officeBranchId: branch, version: 1, user: { ...actor.user, email: null, telp: null, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } };
    await request('POST', '/internal/users/events', 200, userEvent, null, { 'x-user-sync-secret': env.USER_SYNC_SECRET });
    const itemCurrent = await prisma.item.findUniqueOrThrow({ where: { id: itemRow.id } });
    await request('PATCH', `/items/${itemRow.id}`, 200, { version: itemCurrent.version, name: 'Updated Pipe' });
    const itemFinal = await prisma.item.findUniqueOrThrow({ where: { id: itemRow.id } });
    await request('DELETE', `/items/${itemRow.id}`, 200, { version: itemFinal.version });
    const serviceFinal = await prisma.service.findUniqueOrThrow({ where: { id: service.id } });
    await request('DELETE', `/services/${service.id}`, 200, { version: serviceFinal.version });
    const staffFinal = await prisma.companyStaff.findUniqueOrThrow({ where: { id: staff.id } });
    await request('DELETE', `/company-staffs/${staff.id}`, 200, { version: staffFinal.version });
    const report = { operations: routes.length, checks: checks.length, externalDependencies: 'Auth JWKS/profile, Field Service and PDF object storage are local test doubles; real Marketing HTTP app, JWT verification, PDF generation, Excel processing and PostgreSQL', coverage: [...coverage].map(([operation, statuses]) => ({ operation, statuses })) };
    assert.equal(coverage.size, routes.length);
    assert.deepEqual(schemaErrors, [], schemaErrors.join('\n'));
    for (const [operation, statuses] of coverage) assert.ok(statuses.some(status => status < 300), `${operation}: missing successful HTTP coverage`);
    writeFileSync(require('node:path').join(__dirname, 'endpoint-contract.last-run.json'), JSON.stringify(report, null, 2));
    console.log(`PASS: ${checks.length} HTTP checks across all ${routes.length} Marketing operations; response schemas, authorization and branch ownership verified.`);
  } finally {
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => dependencyServer.close(resolve))]);
    try {
      const scope = { officeBranchId: { in: [branch, foreignBranch] } };
      const quotationScope = { quotation: scope };
      await prisma.quotation.updateMany({ where: scope, data: { previousQuotationId: null } });
      await prisma.quotationPdf.deleteMany({ where: quotationScope });
      await prisma.quotationSnapshot.deleteMany({ where: quotationScope });
      await prisma.quotationHistory.deleteMany({ where: quotationScope });
      await prisma.quotationItem.deleteMany({ where: quotationScope });
      await prisma.quotation.deleteMany({ where: scope });
      await prisma.quotationSequence.deleteMany({ where: scope });
      await prisma.companyContractHistory.deleteMany({ where: { companyContract: { company: scope } } });
      await prisma.companyStaffHistory.deleteMany({ where: { companyStaff: { company: scope } } });
      await prisma.companyHistory.deleteMany({ where: { company: scope } });
      await prisma.company.deleteMany({ where: scope });
      await prisma.item.deleteMany({ where: scope });
      await prisma.service.deleteMany({ where: scope });
      await prisma.catalogAuditLog.deleteMany({ where: scope });
      await prisma.taxCache.deleteMany({ where: scope });
      await prisma.taxCacheRevision.deleteMany({ where: { officeBranchId: branch } });
      await prisma.marketingAdminUser.deleteMany({ where: scope });
      await prisma.marketingUserSyncRevision.deleteMany({ where: { userId: actor.user.id } });
    } finally { await prisma.$disconnect(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
