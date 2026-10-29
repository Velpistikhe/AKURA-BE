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
test('HTTP CRUD, module separation, profile/branch enforcement and input validation',async()=>{
 const branch=randomUUID(),otherBranch=randomUUID(),user=randomUUID(),companyId=randomUUID(),sizeId=randomUUID();
 const profile={id:user,officeBranchId:branch,isActive:true,role:'USER',section:'FINANCE',firstName:'Test',lastName:'User',username:'test'};
 const price={itemSizeId:sizeId,priceInspection:'100',priceMaintenance:null,priceSource:'PRIMARY',priceId:randomUUID(),priceVersion:1,catalogSnapshot:{serviceName:'Inspection',serviceType:'INSPECTION',itemName:'Tank',size:null,hasMaintenance:false}};
 let reference={officeBranchId:branch,company:{id:companyId,name:'Company',isSisterCompany:false},items:[price]};
 const originalFetch=global.fetch;
 global.fetch=async(url,options)=>{
  if(!String(url).startsWith(env.API_GATEWAY_URL+'/api/v1/')) return originalFetch(url,options);
  const token=options.headers.Authorization;
  if(String(url).endsWith('/auth/me')) return {ok:true,json:async()=>({data:{...profile,...(token==='Bearer other'?{officeBranchId:otherBranch}:{}),...(token==='Bearer inactive'?{isActive:false}:{}),...(token==='Bearer wrong-section'?{section:'HRD_MANAGEMENT'}:{})}})};
  if(String(url).endsWith('/marketing/billing-price-references')){
   // Marketing resolves the prices in the branch of the caller, so a company of
   // another branch is not found there.
   if(token==='Bearer other')return {ok:false,status:404,json:async()=>({message:'Company not found'})};
   return {ok:true,json:async()=>({data:reference})};
  }
  throw Error('Unexpected upstream call');
 };
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.user={sub:user,type:'access',officeBranchId:req.headers.authorization==='Bearer other'?otherBranch:req.headers.authorization==='Bearer stale'?otherBranch:branch};next();});
 app.use(routes);app.use(errorHandler);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const request=async(method,path,body,status=200,token='valid')=>{const r=await originalFetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'content-type':'application/json',authorization:'Bearer '+token,'x-office-branch-id':otherBranch},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await r.json();assert.equal(r.status,status,JSON.stringify(result));return result.data;};
 try {
  profile.role='ADMIN';
  const savedTax=await request('POST','/taxes',{percentage:'12',effectiveFrom:'2026-01-01'},201);
  assert.equal(savedTax.officeBranchId,branch);
  await request('POST','/taxes',{percentage:'13',effectiveFrom:'2026-01-01'},409);
  await request('POST','/taxes/resync',{},202);
  assert.ok(Array.isArray(await request('GET','/taxes/deliveries')));
  profile.role='USER';
  await request('POST','/taxes',{percentage:'13',effectiveFrom:'2027-01-01'},403);
  await request('GET','/taxes');
   const root='/documents';
   const modules=[['PROFORMA_INVOICE',/^PI\/[0-9]{4}\/000001$/],['INVOICE',/^INV\/[0-9]{4}\/000001$/]];
   let first;
   for(const [kind,numberPattern] of modules){
    // The payload carries the purchase order and the item size UUIDs only.
    const raw={kind,companyId,title:'Purchase order document',purchaseOrderNumber:'PO/2026/000001',purchaseOrderDate:'2026-01-15',items:[sizeId],dueDate:'2099-12-31'};
    await request('POST',root,{...raw,number:'CUSTOM'},400);
    await request('POST',root,{...raw,date:'2020-01-01'},400);
    await request('POST',root,{...raw,officeBranchId:otherBranch},400);
    // A purchase order number and date are required, and the items are UUIDs.
    await request('POST',root,{...raw,purchaseOrderNumber:undefined},400);
    await request('POST',root,{...raw,purchaseOrderDate:undefined},400);
    await request('POST',root,{...raw,items:['not-a-uuid']},400);
    await request('POST',root,{...raw,items:[sizeId,sizeId]},400);
    await request('POST',root,raw,404,'other');
    const row=await request('POST',root,raw,201);
    assert.equal(row.officeBranchId,branch);assert.equal(row.createdByName,'Test User');
    assert.equal(row.kind,kind);
    // The purchase order of the request is stored on the document.
    assert.equal(row.purchaseOrderNumber,'PO/2026/000001');
    assert.equal(row.purchaseOrderDate,'2026-01-15T00:00:00.000Z');
    const detail=await request('GET',root+'/'+row.id);
    assert.equal(detail.items.length,1);
    assert.equal(detail.items[0].quantityInspection,'1');
    assert.equal(detail.items[0].quantityMaintenance,'0');
    assert.equal(detail.items[0].subTotal,'100');
    if(first)await request('GET',root+'/'+first,undefined,404);
    first=row.id;
    await request('PATCH',root+'/'+row.id,{version:0,number:'CUSTOM'},400);
    await request('PATCH',root+'/'+row.id,{version:0,date:'2020-01-01'},400);
    assert.match(row.number,numberPattern);
    // One collection holds both kinds; the document of the previous iteration
    // was soft deleted, so only the active one remains for this kind.
    assert.equal((await request('GET',root+'?kind='+kind)).pagination.total,1);
    await request('GET',root+'/'+row.id,undefined,404,'other');
    await request('GET',root+'/'+row.id+'/history',undefined,404,'other');
    await request('PATCH',root+'/'+row.id,{version:0,title:'No'},404,'other');
    await request('DELETE',root+'/'+row.id,{version:0},404,'other');
    await request('PATCH',root+'/'+row.id,{title:'Missing version'},400);
    const updated=await request('PATCH',root+'/'+row.id,{version:0,title:'Edited',reason:'Corrected title'});
    assert.equal(updated.version,1);
    await request('PATCH',root+'/'+row.id,{version:0,title:'Stale'},409);
    const history=await request('GET',root+'/'+row.id+'/history');
    assert.equal(history.history[0].changes.find(change=>change.field==='title').after,'Edited');
    await request('DELETE',root+'/'+row.id,{version:1,reason:'Cancelled'});
    await request('GET',root+'/'+row.id,undefined,404);
    assert.equal((await request('GET',root+'/'+row.id+'/history')).pagination.total,3);
    await request('GET',root,undefined,403,'inactive');
    await request('GET',root,undefined,403,'wrong-section');
    await request('GET',root,undefined,401,'stale');
   }
 }finally{
  global.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));
  const where={officeBranchId:branch};await prisma.documentHistory.deleteMany({where:{document:where}});await prisma.documentItem.deleteMany({where:{document:where}});await prisma.document.deleteMany({where});await prisma.$executeRaw`DELETE FROM proforma_invoice_sequences WHERE office_branch_id = ${branch}::uuid`;await prisma.$executeRaw`DELETE FROM invoice_sequences WHERE office_branch_id = ${branch}::uuid`;await prisma.taxDelivery.deleteMany({where:{event:where}});await prisma.taxEvent.deleteMany({where});await prisma.taxRevision.deleteMany({where});await prisma.tax.deleteMany({where});await prisma.$disconnect();
 }
});