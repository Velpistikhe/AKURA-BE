const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
require('dotenv').config();
const {prisma}=require('../dist/config/db.js');
const {documentRepository:repo}=require('../dist/modules/documents/document.repository.js');
const {proformaDate,nextProformaIdentity}=require('../dist/modules/proforma-invoices/proforma-number.js');

test('proforma numbering: concurrent creation, annual reset, branch isolation, rollback and recovery',async()=>{
 const actor={id:randomUUID(),name:'Number test',officeBranchId:randomUUID()};
 const rolloverBranch=randomUUID();
 const q={id:randomUUID(),officeBranchId:actor.officeBranchId,version:0,isActive:true,subTotal:'100',tax:'12',status:'APPROVED',subject:'Number test',items:[{id:randomUUID(),itemSizeId:randomUUID(),serviceName:'Inspection',serviceType:'INSPECTION',itemName:'Tank',size:null,note:null,quantityInspection:'1',quantityMaintenance:'0',priceInspection:'100',priceMaintenance:null,discount:'0',subTotal:'100'}]};
 const year=proformaDate().getUTCFullYear();
 let failHistory=false;
 prisma.$use(async(params,next)=>{
  if(failHistory && params.model==='DocumentHistory' && params.action==='create' && params.args.data.createdById===actor.id) throw Error('Simulated history failure');
  return next(params);
 });
 // Every document is billed from its own quotation, so a numbering run may
 // create one document per quotation.
 const create=()=>repo.createFromMarketing('PROFORMA_INVOICE',{...q,id:randomUUID()},new Date('2099-12-31'),null,actor,null);
 const last=async()=> (await prisma.$queryRaw`SELECT last_number FROM proforma_invoice_sequences WHERE office_branch_id=${actor.officeBranchId}::uuid AND year=${year}`)[0]?.last_number;
 const allocate=clock=>prisma.$transaction(tx=>nextProformaIdentity(tx,rolloverBranch,clock));
 try {
  assert.equal(proformaDate(new Date('2026-12-31T16:59:59Z')).toISOString(),'2026-12-31T00:00:00.000Z');
  assert.equal(proformaDate(new Date('2026-12-31T17:00:00Z')).toISOString(),'2027-01-01T00:00:00.000Z');
  // Missing tax must also roll back first counter creation.
  await assert.rejects(create,e=>e.statusCode===409);
  assert.equal(await last(),undefined);
  await prisma.tax.create({data:{officeBranchId:actor.officeBranchId,percentage:'12',effectiveFrom:new Date('2000-01-01'),createdById:actor.id,createdByName:actor.name}});
  const rows=await Promise.all(Array.from({length:8},create));
  assert.deepEqual(rows.map(r=>r.number).sort(),Array.from({length:8},(_,i)=>`PI/${year}/${String(i+1).padStart(6,'0')}`));
  assert(rows.every(r=>r.date.toISOString()===proformaDate().toISOString()));
  assert.equal(await last(),8);
  assert.equal(await prisma.documentHistory.count({where:{document:{officeBranchId:actor.officeBranchId}}}),8);
  failHistory=true;
  await assert.rejects(create,/Simulated history failure/);
  failHistory=false;
  assert.equal(await last(),8);
  assert.equal(await prisma.document.count({where:{officeBranchId:actor.officeBranchId}}),8);
  await assert.rejects(repo.createFromMarketing('PROFORMA_INVOICE',q,new Date('2000-01-01'),null,actor,null),e=>e.statusCode===400);
  assert.equal(await last(),8);
  await repo.mutate(rows[0].id,{version:0},actor,true);
  assert.equal((await create()).number,`PI/${year}/000009`);
  // Seed a missing counter from a deleted historical invoice.
  await prisma.document.update({where:{id:rows[0].id},data:{number:`PI/${year}/000040`}});
  await prisma.$executeRaw`DELETE FROM proforma_invoice_sequences WHERE office_branch_id=${actor.officeBranchId}::uuid`;
  assert.equal((await create()).number,`PI/${year}/000041`);
  const end=()=>new Date('2026-12-31T16:59:59Z');
  const start=()=>new Date('2026-12-31T17:00:00Z');
  assert.equal((await allocate(end)).number,'PI/2026/000001');
  assert.equal((await allocate(end)).number,'PI/2026/000002');
  assert.equal((await allocate(start)).number,'PI/2027/000001');
  // Simulate crossing midnight while acquiring the old-year lock.
  let reads=0;
  const crossed=await allocate(()=>++reads===1?end():start());
  assert.equal(crossed.number,'PI/2027/000002');
  assert.equal(crossed.date.toISOString(),'2027-01-01T00:00:00.000Z');
 } finally {
  failHistory=false;
  const where={officeBranchId:actor.officeBranchId};
  await prisma.documentHistory.deleteMany({where:{document:where}});
  await prisma.documentItem.deleteMany({where:{document:where}});
  await prisma.document.deleteMany({where});
  await prisma.tax.deleteMany({where});
  await prisma.$executeRaw`DELETE FROM proforma_invoice_sequences WHERE office_branch_id IN (${actor.officeBranchId}::uuid,${rolloverBranch}::uuid)`;
  await prisma.$disconnect();
 }
});
