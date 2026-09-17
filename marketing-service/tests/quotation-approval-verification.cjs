const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { mkdirSync, writeFileSync } = require('node:fs');
const express = require('express');
const { prisma } = require('../dist/config/db.js');
const { quotationStorage } = require('../dist/modules/quotations/quotation-storage.js');
const { quotationRepository } = require('../dist/modules/quotations/quotation.repository.js');
const { renderQuotationPdf } = require('../dist/modules/quotations/quotation-pdf.js');
const routes = require('../dist/modules/quotations/quotation.routes.js').default;

async function main() {
  const branch = randomUUID(), actor = { id: randomUUID(), name: 'Approval Test' };
  const audit = { createdById: actor.id, createdByName: actor.name };
  const objects = new Map(); let uploadCount = 0; let failUpload = false; let afterUpload;
  quotationStorage.bucket = () => 'test-bucket';
  quotationStorage.downloadUrl = async (_bucket, key) => ({ url: `https://storage.example/${key}`, expiresAt: new Date(Date.now() + 900000).toISOString() });
  quotationStorage.upload = async (_bucket, key, body) => {
    uploadCount++; objects.set(key, body);
    if (failUpload) throw new Error('Simulated lost PUT response');
    if (afterUpload) await afterUpload();
  };
  quotationStorage.remove = async (_bucket, key) => { objects.delete(key); };
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { res.locals.authUser = { id: actor.id, firstName: 'Approval', lastName: 'Test', officeBranchId: req.headers['x-test-branch'] || branch }; next(); });
  app.use('/quotations', routes);
  app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const request = async (id, body, expected = 200, selectedBranch = branch) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/quotations/${id}/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-test-branch': selectedBranch }, body: JSON.stringify(body),
    });
    const payload = await response.json(); assert.equal(response.status, expected, JSON.stringify(payload)); return payload.data;
  };
  let service, size;
  const fixture = async (changes = {}) => prisma.quotation.create({ data: {
    officeBranchId: branch, date: new Date('2026-09-13'),
    inquiryMethod: 'EMAIL', inquiryDate: new Date('2026-09-10'), subject: 'Inspection and maintenance',
    termOfPayment: '30 days', validity: '1 week', tax: 11, supplyAkura: 'Inspectors and calibrated equipment',
    supplyCustomer: 'Access and handling facilities', location: 'Balikpapan', accomplished: '7 days', deliveryReports: '2 working days',
    companySnapshot: { id: randomUUID(), name: 'Fixture Customer', type: 'PT', address: 'Jakarta' }, customerSnapshot: 'Fixture Contact',
    createdById: actor.id, subTotal: '275.63', taxAmount: '30.32', total: '305.95', ...changes,
    items: { create: { itemSizeId: size.id, position: 0, serviceName: 'Tubular inspection', serviceType: 'TUBULAR',
      itemName: 'Drill Pipe', size: '4 inch', quantityInspection: '2.5', quantityMaintenance: '1.25', priceInspection: '100.25',
      priceMaintenance: '20', subTotal: '275.63', createdById: actor.id } },
  }, include: { items: true, pdfDocument: true } });
  try {
    service = await prisma.service.create({ data: { officeBranchId: branch, name: 'PDF test', type: 'TUBULAR', hasMaintenance: true, ...audit,
      inspectionScopes: { create: [{ inspectionScope: 'Visual Inspection' }, { inspectionScope: 'Old Scope', revoked: true }] },
      maintenanceScopes: { create: { scope: 'Cleaning' } },
      itemCatalog: { create: { officeBranchId: branch, name: 'Pipe', uom: 'JOINT', ...audit, sizes: { create: { size: '4 inch', ...audit } } } },
    }, include: { itemCatalog: { include: { sizes: true } } } });
    size = service.itemCatalog[0].sizes[0];
    const quote = await fixture();
    assert.equal(quote.no, null); assert.equal(quote.numberYear, null);
    assert.equal(await prisma.quotationSequence.count({ where: { officeBranchId: branch } }), 0);
    await request('invalid', { version: 0 }, 400);
    for (const invalid of [{}, { version: -1 }, { version: 0, status: 'APPROVED' }, { version: '0' }]) await request(quote.id, invalid, 400);
    await request(quote.id, { version: 0 }, 404, randomUUID());
    await request(quote.id, { version: 3 }, 409);
    assert.equal(uploadCount, 0);
    const approved = await request(quote.id, { version: 0 });
    const approvedSnapshot = await quotationRepository.find(quote.id, branch);
    assert.equal(approvedSnapshot.items[0].priceSelection.serviceId, service.id);
    assert.equal(approvedSnapshot.items[0].priceSelection.serviceScopes, 'Visual Inspection, Cleaning');
    assert.equal(approvedSnapshot.items[0].priceSelection.inspectionScopes, 'Visual Inspection');
    assert.equal(approvedSnapshot.items[0].priceSelection.maintenanceScopes, 'Cleaning');
    await prisma.inspectionScope.updateMany({ where: { serviceId: service.id, revoked: false }, data: { inspectionScope: 'Changed Scope' } });
    assert.equal(approved.status, 'APPROVED'); assert.equal(approved.version, 1); assert.equal(approved.revision, 0);
    assert.equal(approved.pdfDocument.quotationId, quote.id);
    assert.equal(approved.no, 1); assert.match(approved.pdf.key, /^quotation\//);
    assert.equal(approved.pdfDocument.approvedById, actor.id);
    assert.equal(approved.pdfDocument.approvedByName, actor.name);
    const buffer = objects.get(approved.pdf.key);
    assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
    assert.equal(createHash('sha256').update(buffer).digest('hex'), approved.pdfDocument.sha256);
    assert.equal(buffer.length, approved.pdfDocument.size);
    assert.equal(await prisma.quotationPdf.count({ where: { quotationId: quote.id } }), 1);
    const history = await prisma.quotationHistory.findFirst({ where: { quotationId: quote.id, action: 'APPROVE' } });
    assert.equal(history.snapshot.pdfDocument.key, approved.pdf.key);
    const retry = await request(quote.id, { version: 1 });
    assert.equal(retry.pdf.key, approved.pdf.key); assert.equal(uploadCount, 1);
    await request(quote.id, { version: 0 }, 409);
    const unchanged = await quotationRepository.update(quote.id, { version: 1, subject: quote.subject }, branch, actor);
    assert.equal(unchanged.status, 'APPROVED'); assert.equal(unchanged.pdfDocument.id, approved.pdfDocument.id);
    const revised = await quotationRepository.update(quote.id, { version: 2, subject: 'Revised subject' }, branch, actor);
    assert.equal(revised.status, 'REVISED'); assert.equal(revised.pdfDocument, null); assert.equal(revised.revision, 1);
    assert.notEqual(revised.id, quote.id); assert.equal(revised.previousQuotationId, quote.id);
    assert.equal(revised.version, 0); assert.equal(revised.no, null); assert.equal(revised.numberYear, null);
    const historical = await quotationRepository.find(quote.id, branch);
    assert.equal(historical.isActive, false); assert.equal(historical.status, 'APPROVED');
    assert.equal(historical.subject, quote.subject); assert.equal(historical.pdfDocument.id, approved.pdfDocument.id);
    assert.deepEqual(historical.items, approvedSnapshot.items);
    await request(quote.id, { version: 3 }, 404);
    const detailResponse = await fetch(`http://127.0.0.1:${server.address().port}/quotations/${quote.id}`);
    assert.equal(detailResponse.status, 200);
    assert.equal((await detailResponse.json()).data.pdf.key, approved.pdf.key);
    const editedDraft = await quotationRepository.update(revised.id, { version: 0, subject: 'Draft edited again' }, branch, actor);
    assert.equal(editedDraft.revision, 1); assert.equal(editedDraft.no, null);
    const second = await request(revised.id, { version: 1 });
    assert.equal(second.no, approved.no); assert.equal(second.numberYear, approved.numberYear); assert.equal(second.revision, 1);
    assert.notEqual(second.pdf.key, approved.pdf.key);
    assert.equal(await prisma.quotationPdf.count({ where: { quotationId: quote.id } }), 1);
    assert.equal(await prisma.quotationPdf.count({ where: { quotationId: revised.id } }), 1);
    const { id: _pdfId, ...duplicatePdf } = historical.pdfDocument;
    await assert.rejects(prisma.quotationPdf.create({ data: { ...duplicatePdf, key: randomUUID(), version: 99 } }), e => e.code === 'P2002');
    assert(objects.has(approved.pdf.key));

    const failed = await fixture(); const objectCount = objects.size;
    failUpload = true; await request(failed.id, { version: 0 }, 503); failUpload = false;
    assert.equal(objects.size, objectCount);
    const untouched = await quotationRepository.findActive(failed.id, branch);
    assert.equal(untouched.status, 'CREATED'); assert.equal(untouched.version, 0); assert.equal(untouched.pdfDocument, null);
    assert.equal(untouched.no, null); assert.equal(untouched.numberYear, null);
    assert.equal((await prisma.quotationSequence.findFirst({ where: { officeBranchId: branch } })).lastNumber, 1);
    assert.equal(await prisma.quotationPdf.count({ where: { quotationId: failed.id } }), 0);
    assert.equal(await prisma.quotationHistory.count({ where: { quotationId: failed.id } }), 0);

    const raced = await fixture();
    let racingEdit;
    afterUpload = async () => {
      racingEdit = quotationRepository.update(raced.id, { version: 0, subject: 'Concurrent edit' }, branch, actor)
        .then(() => null, error => error);
    };
    const raceApproved = await request(raced.id, { version: 0 }); afterUpload = undefined;
    assert.equal((await racingEdit).statusCode, 409); assert.equal(raceApproved.no, 2);
    assert.equal(objects.size, objectCount + 1);
    assert.equal((await quotationRepository.findActive(raced.id, branch)).subject, raced.subject);

    const parallel = await fixture();
    const results = await Promise.allSettled([request(parallel.id, { version: 0 }), request(parallel.id, { version: 0 })]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.match(results.find(result => result.status === 'rejected').reason.message, /Quotation has changed/);
    assert.equal(await prisma.quotationPdf.count({ where: { quotationId: parallel.id } }), 1);
    assert.equal(objects.size, objectCount + 2);
    for (const status of ['REJECTED', 'CONFIRMED', 'ON_PROGRESS', 'WORK_ORDER_COMPLETE', 'COMPLETE']) {
      await request((await fixture({ status })).id, { version: 0 }, 409);
    }
    const inactive = await fixture({ isActive: false }); await request(inactive.id, { version: 0 }, 404);
    const empty = await fixture(); await prisma.quotationItem.updateMany({ where: { quotationId: empty.id }, data: { isActive: false } });
    await request(empty.id, { version: 0 }, 409);

    mkdirSync('tmp', { recursive: true }); writeFileSync('tmp/quotation-approval-sample.pdf', buffer);
    const many = { ...quote, no: approved.no, numberYear: approved.numberYear, items: Array.from({ length: 100 }, (_, i) => ({ ...quote.items[0], position: i, itemName: `Pipe ${i + 1} - ${'Long description '.repeat(10)}` })) };
    writeFileSync('tmp/quotation-approval-multipage.pdf', await renderQuotationPdf(many, actor, new Date('2026-09-13')));
    console.log('PASS: approval HTTP validation, branch isolation, metadata/history, idempotency, revisions, upload failure cleanup, concurrent changes, status guards and multipage PDF.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    const where = { quotation: { officeBranchId: branch } };
    await prisma.quotation.updateMany({ where: { officeBranchId: branch }, data: { previousQuotationId: null } });
    await prisma.quotationPdf.deleteMany({ where });
    await prisma.quotationHistory.deleteMany({ where });
    await prisma.quotationItem.deleteMany({ where });
    await prisma.quotation.deleteMany({ where: { officeBranchId: branch } });
    await prisma.quotationSequence.deleteMany({ where: { officeBranchId: branch } });
    if (service) await prisma.service.delete({ where: { id: service.id } });
    await prisma.$disconnect();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
