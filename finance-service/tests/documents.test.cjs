const { test } = require('node:test');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
require('dotenv').config();
const {prisma} = require('../dist/config/db.js');
const {documentRepository: repo} = require('../dist/modules/documents/document.repository.js');
const {documentCreateSchema:createSchema,updateSchema,deleteSchema} = require('../dist/modules/documents/document.schemas.js');
const {loadQuotation} = require('../dist/integrations/gateway.js');
const kind = 'INVOICE';
test('documents: branch isolation, snapshots, atomic history, unique numbers and concurrent mutations', async () => {
 const actor={id:randomUUID(),name:'Branch User',officeBranchId:randomUUID()};
 const outsider={...actor,officeBranchId:randomUUID()};
 const q={id:randomUUID(),officeBranchId:actor.officeBranchId,version:2,isActive:true,no:1,numberYear:2026,subject:'Test document',companySnapshot:{name:'Customer'},customerSnapshot:'Buyer',subTotal:'100.25',taxAmount:'10.03',total:'112.28',tax:'12',status:'APPROVED',items:[{id:randomUUID(),position:0,itemSizeId:randomUUID(),serviceName:'Inspection',serviceType:'INSPECTION',itemName:'Tank',size:null,note:null,quantityInspection:'1',quantityMaintenance:'0',priceInspection:'100.25',priceMaintenance:null,discount:'0',subTotal:'100.25'}]};
 const raw={source:'QUOTATION',kind:'INVOICE',quotation:q,dueDate:'2099-12-31'};
 const {invoiceDate}=require('../dist/modules/invoices/invoice-number.js');
 const year=invoiceDate().getUTCFullYear();
 try {
  await prisma.tax.createMany({data:[actor,outsider].map(a=>({officeBranchId:a.officeBranchId,percentage:'12',effectiveFrom:new Date('2026-01-01'),createdById:a.id,createdByName:a.name}))});
  assert.equal(createSchema.safeParse({...raw,officeBranchId:outsider.officeBranchId}).success,false);
  assert.equal(createSchema.safeParse({...raw,total:'1'}).success,false);
  const row=await repo.createFromMarketing(kind,q,new Date('2099-12-31'),null,actor,null);
  assert.equal(row.tax.toString(),'12'); assert.equal(row.taxAmount.toString(),'12.03'); assert.equal(row.total.toString(),'112.28'); assert.equal(row.number,`INV/${year}/000001`); assert.equal(row.date.toISOString(),invoiceDate().toISOString()); assert.equal(row.version,0);
  assert.equal(row.quotationSnapshot.companySnapshot.name,'Customer');
  for (const action of [()=>repo.get(row.id,outsider),()=>repo.history(row.id,outsider,1,20),()=>repo.mutate(row.id,{version:0,title:'Wrong'},outsider),()=>repo.mutate(row.id,{version:0},outsider,true)]) await assert.rejects(action,e=>e.statusCode===404);
  assert.equal((await repo.list({page:1,limit:20},outsider)).pagination.total,0);
  await assert.rejects(()=>repo.createFromMarketing(kind,q,new Date('2099-12-31'),null,outsider,null),e=>e.statusCode===409);
  const second=await repo.createFromMarketing(kind,q,new Date('2099-12-31'),null,actor,null);
  assert.equal(second.number,`INV/${year}/000002`);
  assert.equal(await prisma.documentHistory.count({where:{documentId:row.id}}),1);
  const sameNumberOtherBranch=await repo.createFromMarketing(kind,{...q,officeBranchId:outsider.officeBranchId},new Date('2099-12-31'),null,outsider,null);
  assert.ok(sameNumberOtherBranch.id); assert.equal(sameNumberOtherBranch.number,row.number);
  const updates=await Promise.allSettled(Array.from({length:12},(_,i)=>repo.mutate(row.id,updateSchema.parse({version:0,title:'Revision '+i,reason:'Reviewed results'}),actor)));
  assert.equal(updates.filter(r=>r.status==='fulfilled').length,1);
  assert.ok(updates.filter(r=>r.status==='rejected').every(r=>r.reason.statusCode===409));
  const current=await repo.get(row.id,actor);
  assert.equal(current.version,1); assert.deepEqual(current.quotationSnapshot,row.quotationSnapshot);
  const history=await repo.history(row.id,actor,1,1);
  assert.equal(history.pagination.total,2); assert.equal(history.history.length,1);
  assert.equal(history.history[0].changedBy.name,'Branch User');
  assert.equal(history.history[0].reason,'Reviewed results');
  assert.ok(history.history[0].changes.some(change=>change.field==='title'&&change.before==='Test document'&&change.label==='Title'));
  const deleted=await repo.mutate(row.id,deleteSchema.parse({version:1,reason:'Cancelled by customer'}),actor,true);
  assert.equal(deleted.isActive,false);assert.equal(deleted.version,2);
  await assert.rejects(()=>repo.get(row.id,actor),e=>e.statusCode===404);
  const finalHistory=await repo.history(row.id,actor,1,20);
  assert.equal(finalHistory.pagination.total,3);assert.equal(finalHistory.history[0].actionLabel,'Document deleted');
  await assert.rejects(()=>repo.mutate(row.id,{version:2},actor,true),e=>e.statusCode===409);
  assert.equal(updateSchema.safeParse({version:0,quotationId:randomUUID()}).success,false);
  assert.equal(updateSchema.safeParse({title:'No version'}).success,false);
  const originalFetch=global.fetch;
  const req={headers:{authorization:'Bearer fixture-token','x-request-id':'fixture'},user:{sub:randomUUID(),type:'access',officeBranchId:actor.officeBranchId}};
  try {
   global.fetch=async(url,options)=> {assert.ok(String(url).endsWith('/marketing/quotation-references/'+q.id));assert.equal(options.headers.Authorization,'Bearer fixture-token');return {ok:true,json:async()=>({data:q})};};
   assert.equal((await loadQuotation(req,q.id,2,actor.officeBranchId)).id,q.id);
   await assert.rejects(()=>loadQuotation(req,q.id,1,actor.officeBranchId),e=>e.statusCode===409);
   await assert.rejects(()=>loadQuotation(req,q.id,2,outsider.officeBranchId),e=>e.statusCode===404);
   global.fetch=async()=>{throw Error('offline');};
   await assert.rejects(()=>loadQuotation(req,q.id,2,actor.officeBranchId),e=>e.statusCode===503);
  } finally {global.fetch=originalFetch;}
 } finally {
  const where={officeBranchId:{in:[actor.officeBranchId,outsider.officeBranchId]}};
  await prisma.documentHistory.deleteMany({where:{document:where}});
  await prisma.documentItem.deleteMany({where:{document:where}});
  await prisma.document.deleteMany({where});
  await prisma.$executeRaw`DELETE FROM invoice_sequences WHERE office_branch_id IN (${actor.officeBranchId}::uuid, ${outsider.officeBranchId}::uuid)`;
  await prisma.tax.deleteMany({where});
  await prisma.$disconnect();
 }
});
