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

test('source contracts: live prices, deadline, branch isolation, atomic items and concurrent approval',async()=>{
 const branch=randomUUID(),user=randomUUID(),companyId=randomUUID(),sizeId=randomUUID();
 const profile={id:user,officeBranchId:branch,isActive:true,role:'USER',section:'MARKETING',firstName:'Finance',lastName:'User',username:'user'};
 const price={itemSizeId:sizeId,priceInspection:'30',priceMaintenance:'40',priceSource:'PRIMARY',priceId:randomUUID(),priceVersion:1,catalogSnapshot:{serviceName:'Inspect',serviceType:'INSPECTION',itemName:'Tank',size:null,hasMaintenance:true}};
 let reference={officeBranchId:branch,company:{id:companyId,name:'Company',isSisterCompany:false},items:[price]},offline=false;
 const quotation={id:randomUUID(),officeBranchId:branch,version:1,isActive:true,status:'APPROVED',subject:'Quotation',tax:'12',subTotal:'100',taxAmount:'12',total:'112',items:[{id:randomUUID(),position:0,itemSizeId:sizeId,...price.catalogSnapshot,note:null,quantityInspection:'2',quantityMaintenance:'1',priceInspection:'30',priceMaintenance:'40',discount:'0',subTotal:'100'}]};
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
  if(String(url).includes('/quotation-references/'))return {ok:true,json:async()=>({data:quotation})};
  if(String(url).includes('/work-orders/by-quotation/'))return {ok:true,json:async()=>({data:null})};
  throw Error('Unexpected upstream '+url);
 };
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={sub:user,type:'access',officeBranchId:branch};next();});app.use(routes);app.use(errorHandler);app.use((_req,res)=>res.status(404).json({message:'Not found'}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const call=async(method,path,body)=>{const r=await originalFetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'content-type':'application/json',authorization:'Bearer valid'},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};};
 const expect=async(method,path,body,status)=>{const r=await call(method,path,body);assert.equal(r.status,status,JSON.stringify(r.body));return r.body.data;};
 const input={source:'DIRECT',companyId,title:'Direct document',items:[{itemSizeId:sizeId,quantityInspection:'2',quantityMaintenance:'1',priceInspection:'30.00',priceMaintenance:'40.00'}]};
 try{
  await prisma.tax.create({data:{officeBranchId:branch,percentage:'12',effectiveFrom:new Date('2020-01-01'),createdById:user,createdByName:'Seed'}});
  for(const root of ['/invoices','/proforma-invoices']){
   await expect('POST',root,{...input,status:'ON_PROGRESS'},400);
   await expect('POST',root,{...input,items:[input.items[0],input.items[0]]},400);
   await expect('POST',root,{...input,items:[{...input.items[0],priceInspection:'31'}]},409);
   await expect('POST',root,{...input,items:[{...input.items[0],quantityInspection:'0',quantityMaintenance:'0'}]},400);
   await expect('POST',root,{...input,dueDate:'2020-01-01'},400);
   for(const source of ['PRIMARY','SISTER_COMPANY','CONTRACT']){
    price.priceSource=source;
    const row=await expect('POST',root,{...input,dueDate:source==='PRIMARY'?null:invoiceDate().toISOString().slice(0,10)},201);
    assert.equal(row.source,'DIRECT');assert.equal(row.quotationId,null);assert.equal(row.status,'DRAFT');assert.equal(row.total,'112');
    const detail=await expect('GET',root+'/'+row.id,undefined,200);
    assert.equal(detail.items.length,1);assert.equal(detail.items[0].pricingSnapshot.priceSource,source);assert.equal(detail.items[0].subTotal,'100');
    await expect('PATCH',root+'/'+row.id,{version:0,status:'FINAL'},409);
    const approvals=await Promise.all(Array.from({length:5},()=>call('POST',root+'/'+row.id+'/approve',{version:0})));
    assert.equal(approvals.filter(r=>r.status===200).length,1);assert.ok(approvals.filter(r=>r.status!==200).every(r=>r.status===409));
    assert.equal((await expect('GET',root+'/'+row.id+'/history',undefined,200)).pagination.total,2);
   }
   for(const dueDate of [undefined,null,'bad','2020-01-01'])await expect('POST',root,{source:'QUOTATION',quotation,dueDate},400);
   const row=await expect('POST',root,{source:'QUOTATION',quotation,dueDate:invoiceDate().toISOString().slice(0,10)},201);
   assert.equal(row.source,'QUOTATION');assert.equal(row.total,'112');
   await expect('PATCH',root+'/'+row.id,{version:0,dueDate:null},400);
   await expect('POST',root+'/from-marketing',{quotation},404);
   await expect('POST',root+'/from-marketing',{quotation,dueDate:null},404);
  }
  reference={...reference,officeBranchId:randomUUID()};await expect('POST','/invoices',input,502);reference={...reference,officeBranchId:branch};
  price.catalogSnapshot.hasMaintenance=false;await expect('POST','/invoices',input,409);price.catalogSnapshot.hasMaintenance=true;
  offline=true;await expect('POST','/invoices',input,503);offline=false;
  profile.section='MARKETING';
  const editable=await expect('POST','/invoices',input,201);
  const edited=await expect('PATCH','/invoices/'+editable.id,{version:0,notes:'Marketing update'},200);assert.equal(edited.version,1);
  await expect('DELETE','/invoices/'+editable.id,{version:1},200);
  await expect('GET','/invoices/'+editable.id,undefined,404);
  profile.section='FINANCE';
  const before=await prisma.document.count({where:{officeBranchId:branch}});
  await expect('POST','/invoices',{...input,items:[{...input.items[0],quantityInspection:'999999999999999'}]},400);
  assert.equal(await prisma.document.count({where:{officeBranchId:branch}}),before);
  const concurrent=await Promise.all(Array.from({length:5},()=>call('POST','/invoices',input)));
  assert.ok(concurrent.every(r=>r.status===201),JSON.stringify(concurrent));assert.equal(new Set(concurrent.map(r=>r.body.data.number)).size,5);
 }finally{
  global.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));
  const where={officeBranchId:branch};
  await prisma.documentHistory.deleteMany({where:{document:where}});await prisma.documentItem.deleteMany({where:{document:where}});await prisma.document.deleteMany({where});
  await prisma.invoiceSequence.deleteMany({where});await prisma.proformaInvoiceSequence.deleteMany({where});await prisma.tax.deleteMany({where});await prisma.$disconnect();
 }
});
