const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const express=require('express');
require('dotenv').config();
const {prisma}=require('../dist/config/db.js');
const {env}=require('../dist/config/env.js');
const routes=require('../dist/routes/index.js').default;
const {errorHandler}=require('../dist/middlewares/error.middleware.js');
const {invoiceDate}=require('../dist/modules/invoices/invoice-number.js');
require('../dist/utils/logger.js').logger.silent=true;

test('purchase order contracts: resolved prices, purchase order fields, branch isolation, atomic items and concurrent approval',async()=>{
 const branch=randomUUID(),user=randomUUID(),companyId=randomUUID(),sizeId=randomUUID();
 const profile={id:user,officeBranchId:branch,isActive:true,role:'USER',section:'MARKETING',firstName:'Finance',lastName:'User',username:'user'};
 const price={itemSizeId:sizeId,priceInspection:'30',priceMaintenance:'40',priceSource:'PRIMARY',priceId:randomUUID(),priceVersion:1,catalogSnapshot:{serviceName:'Inspect',serviceType:'INSPECTION',itemName:'Tank',size:null,hasMaintenance:true}};
 let reference={officeBranchId:branch,company:{id:companyId,name:'Company',isSisterCompany:false},items:[price]},offline=false;
 const originalFetch=global.fetch;
 global.fetch=async(url,options)=>{
  if(!String(url).startsWith(env.API_GATEWAY_URL+'/api/v1/')) return originalFetch(url,options);
  if(String(url).endsWith('/auth/me'))return {ok:true,json:async()=>({data:profile})};
  assert.equal(options.headers.Authorization,'Bearer valid');
  if(offline)throw Error('offline');
  if(String(url).endsWith('/marketing/billing-price-references')){
   assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{companyId,itemSizeIds:[sizeId]});
   return {ok:true,json:async()=>({data:reference})};
  }
  throw Error('Unexpected upstream '+url);
 };
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={sub:user,type:'access',officeBranchId:branch};next();});app.use(routes);app.use(errorHandler);app.use((_req,res)=>res.status(404).json({message:'Not found'}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const call=async(method,path,body)=>{const r=await originalFetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'content-type':'application/json',authorization:'Bearer valid'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};};
 const expect=async(method,path,body,status)=>{const r=await call(method,path,body);assert.equal(r.status,status,JSON.stringify(r.body));return r.body.data;};
 // The payload carries the purchase order and the item size UUIDs only.
 const input={companyId,title:'Purchase order document',purchaseOrderNumber:'PO/2026/000001',purchaseOrderDate:'2026-01-15',items:[sizeId]};
 try{
  await prisma.tax.create({data:{officeBranchId:branch,percentage:'12',effectiveFrom:new Date('2020-01-01'),createdById:user,createdByName:'Seed'}});
  for(const kind of ['INVOICE','PROFORMA_INVOICE']){
   const root='/documents';
   // The kind travels in the payload, so it is required on every create.
   await expect('POST',root,{...input,status:'ON_PROGRESS'},400);
   await expect('POST',root,{...input,kind,status:'ON_PROGRESS'},400);
   // Items are plain UUIDs, so a duplicated or a malformed item is refused.
   await expect('POST',root,{...input,kind,items:[sizeId,sizeId]},400);
   await expect('POST',root,{...input,kind,items:['not-a-uuid']},400);
   // A purchase order number and date are always required.
   await expect('POST',root,{...input,kind,purchaseOrderNumber:undefined},400);
   await expect('POST',root,{...input,kind,purchaseOrderDate:'bad'},400);
   await expect('POST',root,{...input,kind,dueDate:'2020-01-01'},400);
   for(const source of ['PRIMARY','SISTER_COMPANY','CONTRACT']){
    price.priceSource=source;
    const row=await expect('POST',root,{...input,kind,dueDate:source==='PRIMARY'?null:invoiceDate().toISOString().slice(0,10)},201);
    assert.equal(row.source,'DIRECT');assert.equal(row.quotationId,null);assert.equal(row.status,'DRAFT');assert.equal(row.total,'78.4');assert.equal(row.kind,kind);
    // The purchase order of the request is stored on the document.
    assert.equal(row.purchaseOrderNumber,'PO/2026/000001');
    assert.equal(row.purchaseOrderDate,'2026-01-15T00:00:00.000Z');
    const detail=await expect('GET',root+'/'+row.id,undefined,200);
    assert.equal(detail.items.length,1);
    assert.equal(detail.items[0].pricingSnapshot.priceSource,source);
    // One requested UUID becomes one line of one inspection and one maintenance unit.
    assert.equal(detail.items[0].quantityInspection,'1');assert.equal(detail.items[0].quantityMaintenance,'1');
    assert.equal(detail.items[0].subTotal,'70');
    await expect('PATCH',root+'/'+row.id,{version:0,status:'FINAL'},409);
    const approvals=await Promise.all(Array.from({length:5},()=>call('POST',root+'/'+row.id+'/approve',{version:0})));
    assert.equal(approvals.filter(r=>r.status===200).length,1);assert.ok(approvals.filter(r=>r.status!==200).every(r=>r.status===409));
    assert.equal((await expect('GET',root+'/'+row.id+'/history',undefined,200)).pagination.total,2);
   }
   // An item without a maintenance service is billed for its inspection only.
   price.catalogSnapshot.hasMaintenance=false;price.priceMaintenance=null;
   const inspectionOnly=await expect('POST',root,{...input,kind},201);
   const inspectionOnlyDetail=await expect('GET',root+'/'+inspectionOnly.id,undefined,200);
   assert.equal(inspectionOnlyDetail.items[0].quantityMaintenance,'0');
   assert.equal(inspectionOnlyDetail.items[0].priceMaintenance,null);
   assert.equal(inspectionOnlyDetail.items[0].subTotal,'30');
   price.catalogSnapshot.hasMaintenance=true;price.priceMaintenance='40';
  }
  reference={...reference,officeBranchId:randomUUID()};await expect('POST','/documents',{...input,kind:'INVOICE'},502);reference={...reference,officeBranchId:branch};
  offline=true;await expect('POST','/documents',{...input,kind:'INVOICE'},503);offline=false;
  profile.section='MARKETING';
  const editable=await expect('POST','/documents',{...input,kind:'INVOICE'},201);
  const edited=await expect('PATCH','/documents/'+editable.id,{version:0,notes:'Marketing update'},200);assert.equal(edited.version,1);
  await expect('DELETE','/documents/'+editable.id,{version:1},200);
  await expect('GET','/documents/'+editable.id,undefined,404);
  profile.section='FINANCE';
  const before=await prisma.document.count({where:{officeBranchId:branch}});
  await expect('POST','/documents',{...input,kind:'INVOICE',items:['not-a-uuid']},400);
  assert.equal(await prisma.document.count({where:{officeBranchId:branch}}),before);
  const concurrent=await Promise.all(Array.from({length:5},()=>call('POST','/documents',{...input,kind:'INVOICE'})));
  assert.ok(concurrent.every(r=>r.status===201),JSON.stringify(concurrent));assert.equal(new Set(concurrent.map(r=>r.body.data.number)).size,5);
 }finally{
  global.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));
  const where={officeBranchId:branch};await prisma.documentHistory.deleteMany({where:{document:where}});await prisma.documentItem.deleteMany({where:{document:where}});await prisma.document.deleteMany({where});
  await prisma.invoiceSequence.deleteMany({where});await prisma.proformaInvoiceSequence.deleteMany({where});await prisma.tax.deleteMany({where});await prisma.$disconnect();
 }
});