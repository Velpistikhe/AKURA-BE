const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const express=require('express');
require('dotenv').config();
const {prisma}=require('../dist/config/db.js');
const {env}=require('../dist/config/env.js');
const routes=require('../dist/routes/index.js').default;
const {errorHandler}=require('../dist/middlewares/error.middleware.js');
require('../dist/utils/logger.js').logger.silent=true;

test('Marketing creates full-price draft invoices; Finance revalidates quotation and approves draft',async()=>{
 const branch=randomUUID(),user=randomUUID(),quoteId=randomUUID(),itemId=randomUUID(),sizeId=randomUUID();
 const profile={id:user,officeBranchId:branch,isActive:true,role:'USER',section:'MARKETING',firstName:'Marketing',lastName:'User',username:'user'};
 const quotation={id:quoteId,officeBranchId:branch,version:2,isActive:true,status:'APPROVED',subject:'Service',tax:'12',subTotal:'100.00',taxAmount:'12.00',total:'112.00',items:[{id:itemId,position:0,itemSizeId:sizeId,serviceName:'Inspect',serviceType:'INSPECTION',itemName:'Tank',size:'Large',note:null,quantityInspection:'2',quantityMaintenance:'1',priceInspection:'30.00',priceMaintenance:'40.00',discount:'0',subTotal:'100.00'}]};
 const originalFetch=global.fetch;let marketingQuote=quotation;let workOrderRow=null;const upstream=[];
 global.fetch=async(url,options)=>{
  if(!String(url).startsWith(env.API_GATEWAY_URL+'/api/v1/'))return originalFetch(url,options);
  upstream.push({url:String(url),token:options.headers.Authorization});
  if(String(url).endsWith('/auth/me'))return {ok:true,json:async()=>({data:profile})};
  if(String(url).endsWith('/marketing/quotation-references/'+quoteId))return {ok:true,json:async()=>({data:marketingQuote})};
  if(String(url).endsWith('/fieldservice/work-orders/by-quotation/'+quoteId))return {ok:true,json:async()=>({data:workOrderRow})};
  throw Error('Unexpected upstream request '+url);
 };
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={sub:user,type:'access',officeBranchId:branch};next();});app.use(routes);app.use(errorHandler);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const call=async(method,path,body)=>{const r=await originalFetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'content-type':'application/json',authorization:'Bearer valid'},...(body===undefined?{}:{body:JSON.stringify(body?.quotation ? {dueDate:'2099-12-31',...body}:body)})});return {status:r.status,body:await r.json()};};
 const expect=async(method,path,body,status)=>{const result=await call(method,path,body);assert.equal(result.status,status,JSON.stringify(result.body));return result.body.data;};
 let invoice,proforma,second,third;
 try{
  // A Finance master tax must be effective on the document date for the branch.
  await prisma.tax.create({data:{officeBranchId:branch,percentage:'12',effectiveFrom:new Date('2026-01-01'),createdById:user,createdByName:'Tax Seed'}});
  assert.equal((await call('GET','/invoices')).status,403,'Marketing cannot list Finance documents');
  assert.equal((await call('POST','/taxes',{percentage:'12',effectiveFrom:'2026-01-01'})).status,403,'Marketing cannot administer taxes');
  invoice=await expect('POST','/invoices/from-marketing',{quotation,dueDate:'2026-12-31',notes:'30 days'},201);
  assert.equal(invoice.status,'DRAFT');assert.equal(invoice.kind,'INVOICE');assert.equal(invoice.officeBranchId,branch);
  assert.equal(invoice.quotationId,quoteId);assert.equal(invoice.quotationVersion,2);
  assert.equal(new Date(invoice.dueDate).toISOString(),'2026-12-31T00:00:00.000Z');
  assert.equal(invoice.subTotal.toString(),'100');assert.equal(invoice.total.toString(),'112');
  assert.match(invoice.number,/^INV\/\d{4}\/000001$/);
  const reference=upstream.find(call=>call.url.endsWith('/marketing/quotation-references/'+quoteId));
  assert.ok(reference,'Finance must re-read the quotation from Marketing');assert.equal(reference.token,'Bearer valid');
  workOrderRow={id:randomUUID(),quotationId:quoteId,officeBranchId:branch,revoked:false,number:'WO/2026/000001',status:'COMPLETED',version:1,quotationSnapshot:{tax:'12'}};
  proforma=await expect('POST','/proforma-invoices/from-marketing',{quotation,dueDate:'2099-12-31'},201);
  assert.equal(proforma.status,'DRAFT');assert.equal(proforma.kind,'PROFORMA_INVOICE');assert.equal(proforma.dueDate,'2099-12-31T00:00:00.000Z');
   assert.equal(new Date(invoice.dueDate).toISOString(),'2026-12-31T00:00:00.000Z');
   assert.equal((await call('POST','/invoices/from-marketing',{quotation,dueDate:'2026-01-01'})).status,400,'payment deadline cannot precede the generated document date');
  assert.match(proforma.number,/^PI\/\d{4}\/000001$/);
  assert.equal((await call('POST','/invoices/'+invoice.id+'/approve',{version:0})).status,403);
  assert.equal((await call('GET','/invoices/'+invoice.id)).status,403);
  assert.equal((await call('POST','/invoices/from-marketing',{quotation:{...quotation,officeBranchId:randomUUID()}})).status,404);
  marketingQuote={...quotation,status:'REVISED'};
  assert.equal((await call('POST','/invoices/from-marketing',{quotation})).status,409);
  marketingQuote={...quotation,version:4};
  assert.equal((await call('POST','/invoices/from-marketing',{quotation})).status,409);
  marketingQuote=quotation;
  assert.equal((await call('POST','/invoices/from-marketing',{quotation:{...quotation,items:[{...quotation.items[0],priceInspection:'1.00'}]}})).status,409);
  assert.equal((await call('POST','/invoices/from-marketing',{quotation:{...quotation,items:[]}})).status,400);
  // A quotation whose tax differs from Finance's active tax is refused.
  workOrderRow={id:randomUUID(),quotationId:quoteId,officeBranchId:branch,revoked:false,number:'WO/2026/000001',status:'COMPLETED',version:1,quotationSnapshot:{tax:'13'}};
  marketingQuote={...quotation,tax:'13',taxAmount:'13.00',total:'113.00'};
  assert.equal((await call('POST','/invoices/from-marketing',{quotation:marketingQuote})).status,409,'tax must match the active Finance tax');
  // A quotation whose tax differs from the Work Order snapshot is refused.
  workOrderRow={...workOrderRow,quotationSnapshot:{tax:'11'}};
  marketingQuote=quotation;
  assert.equal((await call('POST','/invoices/from-marketing',{quotation})).status,409,'tax must match the Work Order snapshot');
  // An active document already exists while the Work Order is not completed.
  workOrderRow={...workOrderRow,quotationSnapshot:{tax:'12'},status:'IN_PROGRESS'};
  assert.equal((await call('POST','/invoices/from-marketing',{quotation})).status,409,'a COMPLETED Work Order is required for another document');
  // The same request is accepted once the Work Order is completed.
  workOrderRow={...workOrderRow,status:'COMPLETED'};
  second=await expect('POST','/invoices/from-marketing',{quotation},201);
  assert.equal(second.status,'DRAFT');assert.equal(second.workOrderTax.toString(),'12');
  // While the Work Order is running again no further document is accepted.
  workOrderRow={...workOrderRow,status:'IN_PROGRESS'};
  assert.equal((await call('POST','/invoices/from-marketing',{quotation})).status,409,'an active invoice still blocks another one');
  // Without a live Work Order the request is unaffected by the gate.
  workOrderRow=null;
  third=await expect('POST','/invoices/from-marketing',{quotation},201);
  assert.equal(third.status,'DRAFT');
  profile.section='FINANCE';
  const detail=await expect('GET','/invoices/'+invoice.id,undefined,200);
  assert.equal(detail.items.length,1);assert.equal(detail.items[0].priceInspection.toString(),'30');
  assert.equal(detail.items[0].priceMaintenance.toString(),'40');assert.equal(detail.items[0].quantityInspection.toString(),'2');
  assert.equal(detail.items[0].subTotal.toString(),'100');
  await expect('PATCH','/invoices/'+invoice.id,{version:0,status:'ON_PROGRESS'},409);
  const approved=await expect('POST','/invoices/'+invoice.id+'/approve',{version:0},200);
  assert.equal(approved.status,'ON_PROGRESS');assert.equal(approved.version,1);
  await expect('POST','/invoices/'+invoice.id+'/approve',{version:0},409);
 }finally{
  global.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));
  for(const row of [invoice,proforma,second,third])if(row){await prisma.documentHistory.deleteMany({where:{documentId:row.id}});await prisma.documentItem.deleteMany({where:{documentId:row.id}});await prisma.document.deleteMany({where:{id:row.id}});}
  await prisma.$executeRaw`DELETE FROM proforma_invoice_sequences WHERE office_branch_id = ${branch}::uuid`;
  await prisma.$executeRaw`DELETE FROM invoice_sequences WHERE office_branch_id = ${branch}::uuid`;
  await prisma.taxDelivery.deleteMany({where:{event:{officeBranchId:branch}}});await prisma.taxEvent.deleteMany({where:{officeBranchId:branch}});await prisma.taxRevision.deleteMany({where:{officeBranchId:branch}});await prisma.tax.deleteMany({where:{officeBranchId:branch}});
  await prisma.$disconnect();
 }
});
