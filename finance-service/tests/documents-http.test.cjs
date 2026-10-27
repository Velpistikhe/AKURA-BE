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
 const branch=randomUUID(),otherBranch=randomUUID(),user=randomUUID(),quoteId=randomUUID();
 const profile={id:user,officeBranchId:branch,isActive:true,role:'USER',section:'FINANCE',firstName:'Test',lastName:'User',username:'test'};
 const quotation={tax:'12',status:'APPROVED',id:quoteId,officeBranchId:branch,version:0,isActive:true,no:1,numberYear:2026,subject:'Work',companySnapshot:{name:'Company'},customerSnapshot:'Buyer',subTotal:'100',taxAmount:'12',total:'112',items:[{id:randomUUID(),position:0,itemSizeId:randomUUID(),serviceName:'Inspection',serviceType:'INSPECTION',itemName:'Tank',size:null,note:null,quantityInspection:'1',quantityMaintenance:'0',priceInspection:'100',priceMaintenance:null,discount:'0',subTotal:'100'}]};
 const originalFetch=global.fetch;
 global.fetch=async(url,options)=>{
  if(!String(url).startsWith(env.API_GATEWAY_URL+'/api/v1/')) return originalFetch(url,options);
  const token=options.headers.Authorization;
  if(String(url).endsWith('/auth/me')) return {ok:true,json:async()=>({data:{...profile,...(token==='Bearer other'?{officeBranchId:otherBranch}:{}),...(token==='Bearer inactive'?{isActive:false}:{}),...(token==='Bearer wrong-section'?{section:'HRD_MANAGEMENT'}:{})}})};
  if(String(url).endsWith('/quotation-references/'+quoteId)) return {ok:true,json:async()=>({data:quotation})};
  if(String(url).includes('/fieldservice/work-orders/by-quotation/')) return {ok:true,json:async()=>({data:null})};
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
  const modules=['/proforma-invoices','/invoices'];
  let first;
  for(const module of modules){
   const raw={source:'QUOTATION',quotation,dueDate:'2099-12-31'};
   await request('POST',module,{...raw,number:'CUSTOM'},400);
   if(module==='/invoices') {
    await request('POST',module,{...raw,date:'2020-01-01'},400);
   }
   await request('POST',module,{...raw,officeBranchId:otherBranch},400);
   await request('POST',module,{...raw,quotation:{...quotation,version:1}},409);
   await request('POST',module,raw,404,'other');
   const row=await request('POST',module,raw,201);
   assert.equal(row.officeBranchId,branch);assert.equal(row.createdByName,'Test User');
   if(first)await request('GET',module+'/'+first,undefined,404);
   first=row.id;
   await request('PATCH',module+'/'+row.id,{version:0,number:'CUSTOM'},400);
   if(module==='/proforma-invoices') assert.match(row.number,/^PI\/\d{4}\/000001$/);
   if(module==='/invoices') {
    assert.match(row.number,/^INV\/\d{4}\/000001$/);
    await request('PATCH',module+'/'+row.id,{version:0,number:'CUSTOM'},400);
    await request('PATCH',module+'/'+row.id,{version:0,date:'2020-01-01'},400);
   }
   assert.equal((await request('GET',module+'?quotationId='+quoteId)).pagination.total,1);
   await request('GET',module+'/'+row.id,undefined,404,'other');
   await request('GET',module+'/'+row.id+'/history',undefined,404,'other');
   await request('PATCH',module+'/'+row.id,{version:0,title:'No'},404,'other');
   await request('DELETE',module+'/'+row.id,{version:0},404,'other');
   await request('PATCH',module+'/'+row.id,{title:'Missing version'},400);
   const updated=await request('PATCH',module+'/'+row.id,{version:0,title:'Edited',reason:'Corrected title'});
   assert.equal(updated.version,1);
   await request('PATCH',module+'/'+row.id,{version:0,title:'Stale'},409);
   const history=await request('GET',module+'/'+row.id+'/history');
   assert.equal(history.history[0].changes.find(change=>change.field==='title').after,'Edited');
   await request('DELETE',module+'/'+row.id,{version:1,reason:'Cancelled'});
   await request('GET',module+'/'+row.id,undefined,404);
   assert.equal((await request('GET',module+'/'+row.id+'/history')).pagination.total,3);
   await request('GET',module,undefined,403,'inactive');
   await request('GET',module,undefined,403,'wrong-section');
   await request('GET',module,undefined,401,'stale');
  }
 }finally{
  global.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));
  const where={officeBranchId:branch};await prisma.documentHistory.deleteMany({where:{document:where}});await prisma.documentItem.deleteMany({where:{document:where}});await prisma.document.deleteMany({where});await prisma.$executeRaw`DELETE FROM proforma_invoice_sequences WHERE office_branch_id = ${branch}::uuid`;await prisma.$executeRaw`DELETE FROM invoice_sequences WHERE office_branch_id = ${branch}::uuid`;await prisma.taxDelivery.deleteMany({where:{event:where}});await prisma.taxEvent.deleteMany({where});await prisma.taxRevision.deleteMany({where});await prisma.tax.deleteMany({where});await prisma.$disconnect();
 }
});
