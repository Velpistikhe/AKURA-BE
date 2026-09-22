const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { prisma } = require('../dist/config/db.js');
const { quotationRepository: repo } = require('../dist/modules/quotations/quotation.repository.js');
const { quotationApproval } = require('../dist/modules/quotations/quotation-approval.service.js');
const { quotationStorage: storage } = require('../dist/modules/quotations/quotation-storage.js');
const numbering = require('../dist/modules/quotations/quotation-number.js');
async function main() {
  const originalYear = numbering.quotationNumberYear;
  assert.equal(numbering.quotationDate(new Date('2026-12-31T16:59:59Z')).toISOString(), '2026-12-31T00:00:00.000Z');
  assert.equal(numbering.quotationDate(new Date('2026-12-31T17:00:00Z')).toISOString(), '2027-01-01T00:00:00.000Z');
  assert.equal(originalYear(new Date('2026-12-31T16:59:59Z')), 2026);
  assert.equal(originalYear(new Date('2026-12-31T17:00:00Z')), 2027);
  const branches = [randomUUID(), randomUUID()], actor = { id: randomUUID(), name: 'Number test' };
  const fixtures = [], objects = new Map(), audit = { createdById: actor.id, createdByName: actor.name };
  let failUpload = false, failHistory = false;
  prisma.$use(async (params, next) => {
    if (failHistory && params.model === 'QuotationHistory' && params.action === 'create') throw new Error('Simulated history failure');
    return next(params);
  });
  storage.bucket = () => 'test-bucket';
  storage.downloadUrl = async () => ({ url: 'https://storage.example/file.pdf', expiresAt: new Date().toISOString() });
  storage.upload = async (_bucket, key, data) => { objects.set(key, data); if (failUpload) throw new Error('Upload failure'); };
  storage.remove = async (_bucket, key) => { objects.delete(key); };
  try {
    for (const branch of branches) {
      const company = await prisma.company.create({ data: { officeBranchId: branch, name: 'Number test', normalizeName: branch, type: 'PT', npwp: '123', address: 'Jakarta' } });
      const staff = await prisma.companyStaff.create({ data: { companyId: company.id, name: 'Test Contact', normalizeName: 'test contact', title: 'mrs' } });
      const service = await prisma.service.create({ data: { officeBranchId: branch, name: 'Inspection', type: 'TUBULAR', ...audit,
        itemCatalog: { create: { officeBranchId: branch, name: 'Pipe', uom: 'JOINT', ...audit,
          sizes: { create: { size: 'Large', ...audit, price: { create: { priceServicePrimary: '10', priceServiceSisterCompany: '8', ...audit } } } } } },
      }, include: { itemCatalog: { include: { sizes: true } } } });
      await prisma.taxCache.create({data:{id:randomUUID(),officeBranchId:branch,percentage:'11.25',effectiveFrom:new Date('2000-01-01'),sourceUpdatedAt:new Date()}});
      fixtures.push({ branch, companyId: company.id, serviceId: service.id, input: {
        date: '2020-01-01', inquiryMethod: 'EMAIL', inquiryDate: '2020-01-01', subject: 'Inspection', termOfPayment: '30 days', validity: '30 days',
    jobStart: '2026-10-01',

        supplyAkura: 'Equipment', supplyCustomer: 'Access', location: 'Jakarta', accomplished: '7 days', deliveryReports: 'PDF',
        companyId: company.id, staffId: staff.id, items: [{ itemSizeId: service.itemCatalog[0].sizes[0].id, quantityInspection: '1' }],
      } });
    }
    const [a,b] = fixtures;
    const create = f => repo.create(f.input, f.branch, actor);
    const approve = q => quotationApproval.approve(q.id, { version: q.version }, q.officeBranchId, actor);
    const counter = (branch, year) => prisma.quotationSequence.findUniqueOrThrow({ where: { officeBranchId_year: { officeBranchId: branch, year } } });
    numbering.quotationNumberYear = () => 2026;
    await assert.rejects(repo.create({...a.input,tax:99},a.branch,actor));
    const drafts = await Promise.all(Array.from({ length: 5 }, () => create(a)));
    assert(drafts.every(q => q.companySnapshot.staffTitle === 'mrs' && q.customerSnapshot === 'Test Contact'));
    assert(drafts.every(q => q.date.toISOString() === numbering.quotationDate().toISOString()));
    assert.equal(drafts[0].tax.toString(),'11.25'); assert.equal(drafts[0].taxAmount.toString(),'1.13'); assert(drafts[0].taxSourceId);
    assert(drafts.every(q => q.no === null && q.numberYear === null && q.revision === 0 && q.pdfDocument === null));
    assert.equal(await prisma.quotationSequence.count({ where: { officeBranchId: a.branch } }), 0);
    const draftEdit = await repo.update(drafts[0].id, { version: 0, date: '2000-01-01', subject: 'Draft edit' }, a.branch, actor);
    assert.equal(draftEdit.date.toISOString(), drafts[0].date.toISOString());
    assert.equal(draftEdit.no, null); assert.equal(draftEdit.revision, 0);
    await prisma.quotation.update({ where: { id: drafts[1].id }, data: { date: new Date('2000-01-01') } });
    const { staffTitle: _legacyTitle, ...legacyCompany } = drafts[1].companySnapshot;
    await prisma.quotation.update({ where: { id: drafts[1].id }, data: { companySnapshot: legacyCompany } });
    const concurrent = await Promise.all(drafts.slice(1,4).reverse().map(approve));
    assert(concurrent.every(q => q.companySnapshot.staffTitle === 'mrs'));
    assert(concurrent.every(q => q.date.toISOString() === numbering.quotationDate().toISOString()));
    assert.deepEqual(concurrent.map(q=>q.no).sort((x,y)=>x-y), [1,2,3]);
    assert(concurrent.every(q => q.numberYear === 2026));
    assert.equal((await counter(a.branch, 2026)).lastNumber, 3);
    assert.equal((await approve(await create(b))).no, 1);
    const objectCount = objects.size;
    for (const mode of ['upload','history']) {
      failUpload = mode === 'upload'; failHistory = mode === 'history';
      await assert.rejects(approve(drafts[4]), e => e.statusCode === 503);
      failUpload = false; failHistory = false;
      assert.equal(objects.size, objectCount); assert.equal((await counter(a.branch,2026)).lastNumber, 3);
      const failed = await repo.findActive(drafts[4].id,a.branch);
      assert.equal(failed.no,null); assert.equal(failed.status,'CREATED'); assert.equal(failed.version,0);
      assert.equal(await prisma.quotationPdf.count({where:{quotationId:failed.id}}),0);
    }
    assert.equal((await approve(drafts[4])).no,4);
    await repo.deactivate(draftEdit.id,{version:draftEdit.version},a.branch,actor);
    await repo.deactivate(concurrent[0].id,{version:concurrent[0].version},a.branch,actor);
    assert.equal((await repo.find(concurrent[0].id,a.branch)).pdfDocument.key,concurrent[0].pdf.key);
    assert(objects.has(concurrent[0].pdf.key));
    assert.equal((await approve(await create(a))).no,5);
    numbering.quotationNumberYear=()=>2027;
    assert.equal((await approve(await create(a))).no,1); assert.equal((await approve(await create(b))).no,1);
    let source = concurrent[1];
    for (const revision of [1,2]) {
      const draft = await repo.update(source.id,{version:source.version,subject:`Revision ${revision}`,
        items: source.items.filter(item=>item.isActive).map(item=>({id:item.id,itemSizeId:item.itemSizeId,quantityInspection:String(revision+1)}))},a.branch,actor);
      assert.equal(draft.no,null); assert.equal(draft.numberYear,null);
      assert.notEqual(draft.items[0].id,source.items[0].id);
      assert.deepEqual((await repo.find(source.id,a.branch)).items,source.items);
      const approved = await approve(draft);
      assert.equal(approved.date.toISOString(), source.date.toISOString());
      assert.equal(approved.no,source.no); assert.equal(approved.numberYear,2026); assert.equal(approved.revision,revision);
      assert.equal((await repo.find(source.id,a.branch)).pdfDocument.key,source.pdf.key);
      source=approved;
    }
    assert.equal((await counter(a.branch,2026)).lastNumber,5); assert.equal((await counter(a.branch,2027)).lastNumber,1);
    console.log('PASS: unnumbered drafts, concurrent approvals, branch/year isolation, upload/database rollback without gaps, no reuse, and historical revisions retaining the original number.');
  } finally {
    failHistory=false; numbering.quotationNumberYear=originalYear;
    const where={officeBranchId:{in:branches}};
    await prisma.quotation.updateMany({where,data:{previousQuotationId:null}});
    await prisma.quotationPdf.deleteMany({where:{quotation:where}});
    await prisma.quotationHistory.deleteMany({where:{quotation:where}});
    await prisma.quotationItem.deleteMany({where:{quotation:where}});
    await prisma.taxCache.deleteMany({where});
    await prisma.quotation.deleteMany({where}); await prisma.quotationSequence.deleteMany({where});
    for(const f of fixtures){await prisma.service.delete({where:{id:f.serviceId}});await prisma.company.delete({where:{id:f.companyId}});}
    await prisma.$disconnect();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
