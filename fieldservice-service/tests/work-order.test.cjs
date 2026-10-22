const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const express=require('express');
require('dotenv').config();
// Shared secret for the synchronous Marketing callback that clears the
// quotation Work Order link before a revoke commits.
process.env.WORK_ORDER_SYNC_SECRET='work-order-sync-secret-test-0123456789abcdef';
const {prisma}=require('../dist/config/db.js');
const {env}=require('../dist/config/env.js');
const routes=require('../dist/routes/index.js').default;
const {errorHandler}=require('../dist/middlewares/error.middleware.js');
const {workOrderRepository:repo}=require('../dist/modules/work-orders/work-order.repository.js');
const {nextWorkOrderIdentity,workOrderDate}=require('../dist/modules/work-orders/work-order-number.js');
const {createWorkOrderSchema,updateWorkOrderSchema}=require('../dist/modules/work-orders/work-order.schemas.js');
require('../dist/utils/logger.js').logger.silent=true;

test('Creation rejects inspector date overlaps in every non-revoked status and serializes concurrent requests',async()=>{
 const branch=randomUUID(),otherBranch=randomUUID(),user=randomUUID(),inspectorA=randomUUID(),inspectorB=randomUUID();
 const actor={id:user,name:'Schedule Tester',officeBranchId:branch};
 const contractId=randomUUID(),companyId=randomUUID();
 const contract={id:contractId,companyId,status:'APPROVED',isActive:true,contractNumber:'SCHEDULE',
  contractDate:'2026-01-01',effectiveFrom:'2000-01-01',effectiveUntil:'2099-01-01',
  company:{id:companyId,name:'Schedule Company',officeBranchId:branch,revoked:false}};
 const inspectors=[{userId:inspectorA,name:'Schedule A'},{userId:inspectorB,name:'Schedule B'}];
 const input=(startDate='2026-09-15',endDate='2026-09-20',pairs=inspectors)=>
  createWorkOrderSchema.parse({contractId,startDate,endDate:endDate??undefined,inspectors:pairs});
 const create=(...args)=>repo.create(input(...args),contract,actor);
 const conflict=promise=>assert.rejects(promise,error=>error.statusCode===409&&/overlapping work order/.test(error.message));
 const where={officeBranchId:{in:[branch,otherBranch]}};
 const clearOrders=async()=>{
  await prisma.workOrderHistory.deleteMany({where:{workOrder:where}});
  await prisma.workOrderInspector.deleteMany({where:{workOrder:where}});
  await prisma.workOrder.deleteMany({where});
 };
 try{
  for(const inspector of inspectors)await prisma.fieldServiceUser.create({data:{id:inspector.userId,officeBranchId:branch,
   user:{firstName:'Schedule',lastName:inspector.name.slice(-1)},sourceVersion:1,sourceCreatedAt:new Date(),sourceUpdatedAt:new Date()}});
  for(const status of ['DRAFT','IN_PROGRESS','COMPLETED','CANCELED']){
   const existing=await create();
   await prisma.workOrder.update({where:{id:existing.id},data:{status}});
   const sequence=await prisma.workOrderSequence.findFirst({where:{officeBranchId:branch}});
   for(const [start,end] of [['2026-09-16','2026-09-18'],['2026-09-01','2026-09-30'],['2026-09-10','2026-09-15'],['2026-09-20','2026-09-25']]){
    // A conflict for the second inspector alone must also reject creation.
    await conflict(create(start,end,[inspectors[1]]));
   }
   assert.equal(await prisma.workOrder.count({where}),1);
   assert.equal(await prisma.workOrderHistory.count({where:{workOrder:where}}),1);
   assert.equal((await prisma.workOrderSequence.findFirst({where:{officeBranchId:branch}})).lastNumber,sequence.lastNumber);
   await create('2026-09-01','2026-09-14');
   await create('2026-09-21','2026-09-25');
   await clearOrders();
  }
  const existing=await create('2026-09-15','2026-09-20',[inspectors[0]]);
  await create('2026-09-15','2026-09-20',[inspectors[1]]);
  await clearOrders();
  // Deleted rows release the inspector schedule.
  const revoked=await create();
  await repo.revoke(revoked.id,0,actor);
  await create();
  await clearOrders();
  // Name-only rows from PATCH still reserve their inspector's dates.
  const legacy=await create();
  await repo.update(legacy.id,updateWorkOrderSchema.parse({version:0,inspectors:['Schedule A']}),null,actor);
  await conflict(create());
  await clearOrders();
  // Another branch never blocks the authenticated branch's schedule.
  await prisma.workOrder.create({data:{officeBranchId:otherBranch,number:existing.number,date:new Date('2026-01-01'),
   startDate:new Date('2026-09-15'),endDate:new Date('2026-09-20'),createdById:user,createdByName:actor.name,
   inspectors:{create:{userId:inspectorA,name:'Schedule A',position:0}}}});
  await create();
  await clearOrders();
  // Missing end dates extend indefinitely in both existing and requested orders.
  await create('2026-09-15',null);
  await conflict(create('2027-01-01','2027-01-02'));
  await clearOrders();
  await create('2027-01-01','2027-01-02');
  await conflict(create('2026-09-15',null));
  await clearOrders();
  const races=await Promise.allSettled(Array.from({length:6},(_,i)=>create('2026-09-15','2026-09-20',i%2?[...inspectors].reverse():inspectors)));
  assert.equal(races.filter(result=>result.status==='fulfilled').length,1);
  assert(races.filter(result=>result.status==='rejected').every(result=>result.reason.statusCode===409));
  assert.equal(await prisma.workOrder.count({where}),1);
 }finally{
  await clearOrders();
  await prisma.workOrderSequence.deleteMany({where});
  await prisma.fieldServiceUser.deleteMany({where:{id:{in:[inspectorA,inspectorB]}}});
  await prisma.$disconnect();
 }
});

test('PATCH rejects inspector schedule overlaps and keeps the stored state on rejection',async()=>{
 const branch=randomUUID(),user=randomUUID(),inspectorA=randomUUID(),inspectorB=randomUUID();
 const actor={id:user,name:'Patch Guard Tester',officeBranchId:branch};
 const contractId=randomUUID(),companyId=randomUUID();
 const contract={id:contractId,companyId,status:'APPROVED',isActive:true,contractNumber:'PATCH-GUARD',
  contractDate:'2026-01-01',effectiveFrom:'2000-01-01',effectiveUntil:'2099-01-01',
  company:{id:companyId,name:'Patch Guard Company',officeBranchId:branch,revoked:false}};
 const guards=[{userId:inspectorA,name:'Guard A'},{userId:inspectorB,name:'Guard B'}];
 const create=(startDate,endDate,pairs=guards)=>
  repo.create(createWorkOrderSchema.parse({contractId,startDate,endDate,inspectors:pairs}),contract,actor);
 const where={officeBranchId:branch};
 const clearOrders=async()=>{
  await prisma.workOrderHistory.deleteMany({where:{workOrder:where}});
  await prisma.workOrderInspector.deleteMany({where:{workOrder:where}});
  await prisma.workOrder.deleteMany({where});
 };
 try{
  for(const inspector of guards)await prisma.fieldServiceUser.create({data:{id:inspector.userId,officeBranchId:branch,
   user:{firstName:'Guard',lastName:inspector.name.slice(-1)},sourceVersion:1,sourceCreatedAt:new Date(),sourceUpdatedAt:new Date()}});
  // Guard A is booked twice in two non-overlapping windows; Guard B is booked
  // in the same window as the first one. Different inspectors never block each
  // other, so all three creations succeed.
  const first=await create('2026-09-15','2026-09-20',[guards[0]]);
  const second=await create('2026-10-01','2026-10-05',[guards[0]]);
  const other=await create('2026-09-15','2026-09-20',[guards[1]]);
  // Moving a period into a window the same inspector already holds is rejected.
  await assert.rejects(repo.update(second.id,updateWorkOrderSchema.parse({version:0,startDate:'2026-09-16',endDate:'2026-09-18'}),null,actor),
   error=>error.statusCode===409&&/overlapping work order/.test(error.message));
  // Replacing the inspector list with an inspector that is already booked in an
  // overlapping window is rejected too, even though PATCH only carries names:
  // the name resolves back to the Auth user ID through the branch read model.
  await assert.rejects(repo.update(other.id,updateWorkOrderSchema.parse({version:0,inspectors:['Guard A']}),null,actor),
   error=>error.statusCode===409&&/overlapping work order/.test(error.message));
  // A rejected PATCH leaves the stored Work Order untouched.
  const unchangedSecond=await repo.get(second.id,actor);
  assert.equal(unchangedSecond.version,0);
  assert.equal(unchangedSecond.startDate.toISOString().slice(0,10),'2026-10-01');
  assert.equal(unchangedSecond.endDate.toISOString().slice(0,10),'2026-10-05');
  const unchangedOther=await repo.get(other.id,actor);
  assert.equal(unchangedOther.version,0);
  assert.deepEqual(unchangedOther.inspectors.map(x=>x.name),['Guard B']);
  // Re-saving the same inspector and period stays valid: the edited Work Order
  // never blocks itself.
  const same=await repo.update(other.id,updateWorkOrderSchema.parse({version:0,inspectors:['Guard B']}),null,actor);
  assert.equal(same.version,1);
  assert.deepEqual(same.inspectors.map(x=>x.name),['Guard B']);
  // A name-only row (written by PATCH) keeps its reservation: it is matched by
  // name, so moving another Work Order of the same inspector into that window
  // is still rejected.
  await repo.update(first.id,updateWorkOrderSchema.parse({version:0,inspectors:['Guard A']}),null,actor);
  const legacy=await create('2026-11-01','2026-11-05',[guards[0]]);
  await assert.rejects(repo.update(legacy.id,updateWorkOrderSchema.parse({version:0,startDate:'2026-09-16',endDate:'2026-09-18'}),null,actor),
   error=>error.statusCode===409&&/overlapping work order/.test(error.message));
  // Clearing the inspector list releases the reservation.
  const cleared=await repo.update(other.id,updateWorkOrderSchema.parse({version:1,inspectors:[]}),null,actor);
  assert.equal(cleared.inspectors.length,0);
  assert.equal((await repo.get(first.id,actor)).version,1,'an unrelated Work Order is never modified');
 }finally{
  await clearOrders();
  await prisma.workOrderSequence.deleteMany({where});
  await prisma.fieldServiceUser.deleteMany({where:{id:{in:[inspectorA,inspectorB]}}});
  await prisma.$disconnect();
 }
});

test('Work order HTTP CRUD, contract resolution, lean snapshots, inspectors, branch isolation, concurrency and annual numbering',async()=>{
 const branch=randomUUID(),otherBranch=randomUUID(),clockBranch=randomUUID(),user=randomUUID(),quoteId=randomUUID();
 const inspectorA=randomUUID(),inspectorB=randomUUID(),foreignInspector=randomUUID();
 const branches=[branch,otherBranch,clockBranch];
 const actor={id:user,name:'Test User',officeBranchId:branch};
 const contractId=randomUUID(),companyId=randomUUID();
 // Marketing contract reference: APPROVED status (the live CompanyContractStatus enum has no
 // ACTIVE value), plus the number/date/company identity the lean snapshot must persist.
 const contract={id:contractId,companyId,version:0,status:'APPROVED',isActive:true,contractNumber:'CT-2026/001',contractDate:'2026-01-01T00:00:00.000Z',effectiveFrom:'2000-01-01T00:00:00.000Z',effectiveUntil:'2099-01-01T00:00:00.000Z',company:{id:companyId,name:'Customer Co',officeBranchId:branch,revoked:false},prices:[{id:randomUUID(),priceService:'10'}]};
 // Quotation reference: full Marketing payload. Prices are served upstream so the
 // reduced snapshot can prove they are dropped before they are stored.
 const quotation={status:'APPROVED',id:quoteId,officeBranchId:branch,version:0,isActive:true,no:1,numberYear:2026,revision:0,date:'2026-09-01T00:00:00.000Z',jobStart:'ASAP',inquiryMethod:'EMAIL',inquiryDate:'2026-08-01T00:00:00.000Z',subject:'Work',termOfPayment:'COD',validity:'30 days',supplyAkura:'Akura',supplyCustomer:'Customer',location:'Site',accomplished:'-',deliveryReports:'-',deliveryInvoice:'-',staffId:randomUUID(),customerSnapshot:'Buyer',companySnapshot:{name:'Company'},subTotal:'100',taxAmount:'11',total:'111',createdAt:'2026-09-01T00:00:00.000Z',updatedAt:'2026-09-01T00:00:00.000Z',futureMarketingColumn:'should not be stored',items:[{id:randomUUID(),itemSizeId:randomUUID(),position:0,serviceName:'Inspection',serviceType:'INSPECTION',itemName:'Tank',size:'L',note:null,quantityInspection:'1',quantityMaintenance:'0',priceInspection:'100',priceMaintenance:null,subTotal:'100',priceSelection:null,isActive:true,version:0,futureItemColumn:'should not be stored'}]};
 const originalFetch=global.fetch;
 let quotationCalls=0,upstreamFails=false,contractStatus=200,contractReferenceCalls=0,quotationHttpStatus=200;
 let authInspectorCalls=0,authInspectorFails=false,authInspectorNames=null,authInspectorMissing=null;
 let marketingCallbackCalls=0,marketingCallbackMode='ok',marketingCallbackBodies=[];
 global.fetch=async(url,options)=>{
  if(!String(url).startsWith(env.API_GATEWAY_URL+'/api/v1/'))return originalFetch(url,options);
  // Synchronous Marketing callback used by DELETE before the revoke commits.
  if(String(url).endsWith('/marketing/internal/work-orders/events')){
   assert.equal(String(url),env.API_GATEWAY_URL+'/api/v1/marketing/internal/work-orders/events');
   assert.equal(options.headers['x-service-name'],'fieldservice-service');
   assert.equal(options.headers['x-service-secret'],env.GATEWAY_SECRET);
   assert.equal(options.headers['x-work-order-sync-secret'],env.WORK_ORDER_SYNC_SECRET);
   marketingCallbackCalls++;
   marketingCallbackBodies.push(JSON.parse(options.body));
   if(marketingCallbackMode==='down')throw Error('offline');
   if(marketingCallbackMode==='reject')return {ok:false,status:409,json:async()=>({message:'Quotation is linked to a different Work Order'})};
   if(marketingCallbackMode==='invalid')return {ok:true,status:200,json:async()=>({success:true,workOrderId:'wrong-id'})};
   return {ok:true,status:200,json:async()=>({success:true,workOrderId:JSON.parse(options.body).workOrderId,quotationId:JSON.parse(options.body).quotationId,revoked:true})};
  }
  const token=options.headers.Authorization;
  if(String(url).endsWith('/auth/me'))return {ok:true,json:async()=>({data:{id:user,officeBranchId:token==='Bearer other'?otherBranch:branch,isActive:token!=='Bearer inactive',role:token==='Bearer admin'?'ADMIN':token==='Bearer manager'?'APP_MANAGER':'USER',section:token==='Bearer wrong'?'HRD_MANAGEMENT':['Bearer admin','Bearer manager','Bearer no-section'].includes(token)?null:token==='Bearer field'?'FIELD_SERVICE':'MARKETING',firstName:'Test',lastName:'User',username:'test'}})};
  // Branch-scoped Auth inspector validation used by POST /:id/start. Auth only
  // returns eligible users of the caller branch; a missing user or a changed
  // display name simulates drift between the stored snapshot and Auth.
  if(String(url).includes('/auth/users/field-service/inspectors')){
   authInspectorCalls++;
   if(authInspectorFails)throw Error('offline');
   const requested=new URL(url).searchParams.get('ids').split(',');
   const catalog={[inspectorA]:authInspectorNames?.[inspectorA]??'Budi Tester',[inspectorB]:authInspectorNames?.[inspectorB]??'Agus Helper'};
   const rows=requested.filter(id=>catalog[id]!==undefined&&!authInspectorMissing?.includes(id)).map(id=>({id,name:catalog[id]}));
   return {ok:true,json:async()=>({data:{inspectors:token==='Bearer other'?[]:rows}})};
  }
  if(String(url).includes('/contract-references/')) {
   contractReferenceCalls++;
   const referenced=String(url).split('/').pop();
   if(upstreamFails)throw Error('offline');
   if(referenced!==contractId)return {ok:false,status:404,json:async()=>({message:'Referenced record not found'})};
   if(contractStatus!==200)return {ok:false,status:contractStatus,json:async()=>({message:'Unable to validate reference with upstream service'})};
   return {ok:true,json:async()=>({data:{...contract,company:{...contract.company,officeBranchId:token==='Bearer other'?otherBranch:contract.company.officeBranchId}}})};
  }
  quotationCalls++;
  if(upstreamFails)throw Error('offline');
  if(quotationHttpStatus!==200)return {ok:false,status:quotationHttpStatus,json:async()=>({message:'Active quotation not found in this branch'})};
  const referenced=String(url).split('/').pop();
  if(!quotationIds.has(referenced))return {ok:false,status:404,json:async()=>({message:'Referenced record not found'})};
  return {ok:true,json:async()=>({data:{...quotation,id:referenced}})};
 };
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.user={sub:user,type:'access',officeBranchId:['Bearer other','Bearer stale'].includes(req.headers.authorization)?otherBranch:branch};next();});
 app.use(routes);app.use(errorHandler);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const request=async(method,path,body,status=200,token='valid',expectedMessage)=>{
  const response=await originalFetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'content-type':'application/json',authorization:'Bearer '+token,'x-office-branch-id':otherBranch},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));
  if(expectedMessage)assert.match(result.message,expectedMessage);
  return result.data;
 };
 const inspectorNames=['Budi Tester','Agus Helper'];
 const inspectorPairs=[{userId:inspectorA,name:inspectorNames[0]},{userId:inspectorB,name:inspectorNames[1]}];
 const raw={contractId,startDate:'2026-09-15',endDate:'2026-09-20',inspectors:inspectorPairs};
 const year=workOrderDate().getUTCFullYear();
 // Quotation basis is resolved live from Marketing; the mock serves the current quotation state for every registered ID.
 const quotationIds=new Set([quoteId]);
 const seedQuotationSnapshot=async(changes={})=>{Object.assign(quotation,changes);};
 const startableQuoteId=randomUUID();
 const seedQuotationSnapshotFor=async id=>{quotationIds.add(id);};
 const seedInspector=async(id,officeBranchId,firstName,lastName)=>prisma.fieldServiceUser.upsert({where:{id},create:{id,officeBranchId,user:{id,firstName,lastName,username:firstName.toLowerCase()},sourceVersion:1,sourceCreatedAt:new Date(),sourceUpdatedAt:new Date()},update:{officeBranchId}});
 try{
  await seedInspector(inspectorA,branch,'Budi','Tester');await seedInspector(inspectorB,branch,'Agus','Helper');await seedInspector(foreignInspector,otherBranch,'Foreign','Inspector');
  assert.equal((await originalFetch(`http://127.0.0.1:${server.address().port}/reports`)).status,404);
  assert.equal((await originalFetch(`http://127.0.0.1:${server.address().port}/documents`)).status,404);
  for(const invalid of [{number:'CUSTOM'},{date:'2026-01-01'},{officeBranchId:otherBranch},{createdByName:'Fake'},{revoked:true},{status:'INVALID'},{status:'DRAFT'},{inspectors:[]},{inspectors:[inspectorPairs[0],inspectorPairs[0]]},{inspectors:[{userId:'not-a-uuid',name:'X'}]},{inspectors:[{userId:randomUUID(),name:'Ghost Inspector'}]},{inspectors:[{userId:foreignInspector,name:'Foreign Inspector'}]},{inspectors:[{userId:inspectorA,name:'Wrong Name'}]},{inspectors:[{inspectorId:inspectorA}]},{inspectors:[{userId:inspectorA}]},{endDate:'2026-01-01'},{contractVersion:1},{summary:'Inspection'},{quotationVersion:0}])await request('POST','/work-orders',{...raw,...invalid},400);
  // The document basis is IDs only: companyId is no longer accepted at all.
  for(const invalid of [{companyId},{companyId:randomUUID()},{companyId:null}])await request('POST','/work-orders',{...raw,...invalid},400);
  // Both basis fields empty, or both supplied, is not exactly one basis.
  for(const invalid of [{contractId:null},{contractId:null,quotationId:null},{contractId,quotationId:quoteId}])await request('POST','/work-orders',{...raw,...invalid},400);
  // A quotation basis still requires endDate and inspectors of its own.
  const quotationBasis={contractId:null,quotationId:quoteId,startDate:'2026-10-15',endDate:'2026-10-20',inspectors:inspectorPairs};
  await request('POST','/work-orders',{...quotationBasis,endDate:undefined},400);
  await request('POST','/work-orders',{...quotationBasis,inspectors:undefined},400);
  await request('POST','/work-orders',{...quotationBasis,inspectors:[]},400);
  const row=await request('POST','/work-orders',raw,201);
  assert.equal(row.status,'DRAFT');
  for(const token of ['field','wrong','no-section','admin','manager']){
   await request('POST','/work-orders',raw,403,token);
   await request('DELETE','/work-orders/'+row.id,{version:0},403,token);
   await request('POST','/work-orders/'+row.id+'/start',{version:0},403,token);
   if(token!=='field')await request('PATCH','/work-orders/'+row.id,{version:0,startDate:'2026-10-01'},403,token);
  }
  await request('GET','/work-orders/'+row.id,undefined,200,'field');
  assert.equal((await repo.get(row.id,actor)).version,0);
  assert.equal((await repo.get(row.id,actor)).revoked,false);
  assert.equal(quotationCalls,0);assert.equal(row.number,`WO/${year}/000001`);assert.equal(row.date,workOrderDate().toISOString());
  assert.equal(row.quotationId,null);assert.equal(row.quotationSnapshot,null);assert.equal(row.officeBranchId,branch);assert.equal(row.createdByName,'Test User');assert.equal(row.createdById,user);
  assert.deepEqual(row.inspectors.map(x=>x.name),inspectorNames);assert.equal(row.status,'DRAFT');
  assert.deepEqual(row.inspectors.map(x=>x.userId),[inspectorA,inspectorB],'create snapshots idUser from FieldServiceUser');
  const initialHistory=await request('GET','/work-orders/'+row.id+'/history');
  assert.equal(initialHistory.pagination.total,1);assert.equal(initialHistory.history[0].action,'CREATE');
  assert.equal(initialHistory.history[0].beforeSnapshot,null);assert.equal(initialHistory.history[0].createdById,user);
  assert.equal(initialHistory.history[0].createdByName,'Test User');
  assert.equal(initialHistory.history[0].actionLabel,'Work order created');
  assert.deepEqual(initialHistory.history[0].changedBy,{id:user,name:'Test User'});
  assert(initialHistory.history[0].changes.some(change=>change.field==='startDate'&&change.label==='Start date'&&change.before===null&&change.after==='2026-09-15T00:00:00.000Z'));
  assert.deepEqual(initialHistory.history[0].snapshot.inspectors.map(x=>x.name),inspectorNames);
  await request('GET','/work-orders/'+row.id+'/history',undefined,404,'other');
  await request('GET','/work-orders/'+row.id+'/history?page=0',undefined,400);
  const foreign=await request('POST','/work-orders',{...raw,inspectors:[{userId:foreignInspector,name:'Foreign Inspector'}]},201,'other');assert.equal(foreign.number,row.number);
  for(const token of ['inactive','wrong','stale'])await request('GET','/work-orders',undefined,token==='stale'?401:403,token);
  await request('GET','/work-orders/'+row.id,undefined,404,'other');await request('PATCH','/work-orders/'+row.id,{version:0,startDate:'2026-11-01'},404,'other');await request('DELETE','/work-orders/'+row.id,{version:0},404,'other');
  assert.equal(row.contractId,contractId);assert.equal(row.contractSnapshot.companyId,companyId);
  assert.equal(row.contractSnapshot.version,contract.version);
  // Lean contract snapshot: number/date/period/company identity only.
  assert.equal(row.contractSnapshot.contractNumber,contract.contractNumber);
  assert.equal(row.contractSnapshot.contractDate,contract.contractDate);
  assert.equal(row.contractSnapshot.effectiveFrom,contract.effectiveFrom);
  assert.equal(row.contractSnapshot.effectiveUntil,contract.effectiveUntil);
  assert.equal(row.contractSnapshot.companyName,contract.company.name);
  assert.equal(Object.hasOwn(row.contractSnapshot,'prices'),false,'contract snapshot never stores price rows');
  assert.equal(Object.hasOwn(row.contractSnapshot,'company'),false,'contract snapshot stores company identity, not the full company');
  for(const status of [404,409]){contractStatus=status;await request('POST','/work-orders',raw,status);}contractStatus=200;
  upstreamFails=true;await request('POST','/work-orders',raw,503);upstreamFails=false;
  // A contract whose company linkage is inconsistent is rejected by the reference
  // identity guard, the same way an unknown contract ID is.
  contract.companyId=randomUUID();await request('POST','/work-orders',raw,404);contract.companyId=companyId;
  contract.company.officeBranchId=otherBranch;await request('POST','/work-orders',raw,404);contract.company.officeBranchId=branch;
  contract.company.revoked=true;await request('POST','/work-orders',raw,409);contract.company.revoked=false;
  contract.effectiveFrom='2098-01-01T00:00:00.000Z';await request('POST','/work-orders',raw,409);contract.effectiveFrom='2000-01-01T00:00:00.000Z';
  const basis={...quotationBasis};
  await seedQuotationSnapshot({status:'CREATED'});await request('POST','/work-orders',basis,409);
  await seedQuotationSnapshot({status:'APPROVED'});
  contract.status='CREATE';await request('POST','/work-orders',raw,409);contract.status='APPROVED';
  contract.effectiveUntil='2000-01-02T00:00:00.000Z';await request('POST','/work-orders',raw,409);contract.effectiveUntil='2099-01-01T00:00:00.000Z';
  await request('PATCH','/work-orders/'+row.id,{version:0,companyId:null},400);
  // Contract-priced quotations can be used directly and still exclude prices from the snapshot.
  quotation.items[0].priceSelection={priceSource:'CONTRACT',contractId};
  const linked=await request('POST','/work-orders',basis,201);assert.equal(linked.quotationSnapshot.id,quoteId);
  assert.equal(linked.quotationSnapshot.version,quotation.version);
  // Lean quotation snapshot: identity and descriptive content, no price anywhere.
  for(const priceField of ['subTotal','taxAmount','total','tax','taxSourceId'])
   assert.equal(Object.hasOwn(linked.quotationSnapshot,priceField),false,`quotation snapshot never stores ${priceField}`);
  assert.equal(linked.quotationSnapshot.subject,quotation.subject);
  assert.equal(linked.quotationSnapshot.customerSnapshot,quotation.customerSnapshot);
  assert.deepEqual(linked.quotationSnapshot.companySnapshot,quotation.companySnapshot);
  assert.equal(linked.quotationSnapshot.items.length,1);
  assert.deepEqual(linked.quotationSnapshot.items[0],{id:quotation.items[0].id,itemSizeId:quotation.items[0].itemSizeId,position:0,
   serviceName:'Inspection',serviceType:'INSPECTION',itemName:'Tank',size:'L',note:null,quantityInspection:'1',quantityMaintenance:'0',isActive:true,version:0},
   'quotation snapshot items carry description and quantity only');
  // The snapshot is an allowlist projection: a future Marketing column never arrives.
  assert.equal(Object.hasOwn(linked.quotationSnapshot,'futureMarketingColumn'),false);
  assert.equal(Object.hasOwn(linked.quotationSnapshot.items[0],'futureItemColumn'),false);
  const list=await request('GET','/work-orders');
  const listed=list.workOrders.find(workOrder=>workOrder.id===linked.id);
  assert(listed,'created work order is returned by the list endpoint');
  assert.equal(Object.hasOwn(listed,'inspectors'),false,'list response omits inspectors');
  assert.equal(Object.hasOwn(listed,'quotationSnapshot'),false,'list response omits quotation snapshot');
  assert.equal(Object.hasOwn(listed,'contractSnapshot'),false,'quotation-based list row omits null contract snapshot');
  assert.equal(listed.quotationNo,quotation.no);
  assert.equal(listed.quotationDate,'2026-09-01');
  assert.equal(listed.contractNumber,null);
  const listedContract=list.workOrders.find(workOrder=>workOrder.id===row.id);
  assert(listedContract,'contract-based work order is returned by the list endpoint');
  assert.equal(listedContract.contractId,contractId);
  assert.equal(Object.hasOwn(listedContract,'contractSnapshot'),false,'contract-based list row omits contract snapshot');
  assert.equal(Object.hasOwn(listedContract,'quotationSnapshot'),false);
  assert.equal(listedContract.contractNumber,contract.contractNumber);
  assert.equal(listedContract.contractDate,'2026-01-01');
  assert.equal(listedContract.companyId,companyId);
  assert.equal(listedContract.company,contract.company.name);
  assert.equal(listedContract.quotationNo,null);
  assert.equal(listedContract.quotationDate,null);
  assert.deepEqual((await request('GET','/work-orders/'+linked.id)).quotationSnapshot,linked.quotationSnapshot);
  // Missing historical snapshot values must not break the list response.
  try {
   for(const snapshot of [{...linked.quotationSnapshot,no:null,date:null},{},require('@prisma/client').Prisma.DbNull]){
    await prisma.workOrder.update({where:{id:linked.id},data:{quotationSnapshot:snapshot}});
    const missing=await request('GET','/work-orders?quotationId='+quoteId+'&limit=1');
    assert.equal(missing.pagination.total,1);
    assert.equal(missing.workOrders[0].quotationNo,null);
    assert.equal(missing.workOrders[0].quotationDate,null);
    assert.equal(Object.hasOwn(missing.workOrders[0],'quotationSnapshot'),false);
   }
   for(const snapshot of [{},require('@prisma/client').Prisma.DbNull]){
    await prisma.workOrder.update({where:{id:row.id},data:{contractSnapshot:snapshot}});
    const missing=await request('GET','/work-orders?contractId='+contractId);
    assert.equal(missing.workOrders.find(item=>item.id===row.id).contractNumber,null);
    assert.equal(missing.workOrders.find(item=>item.id===row.id).contractDate,null);
    assert.equal(missing.workOrders.find(item=>item.id===row.id).companyId,null);
    assert.equal(missing.workOrders.find(item=>item.id===row.id).company,null);
   }
  } finally {
   await prisma.workOrder.update({where:{id:linked.id},data:{quotationSnapshot:linked.quotationSnapshot}});
   await prisma.workOrder.update({where:{id:row.id},data:{contractSnapshot:row.contractSnapshot}});
  }
  for(const field of ['date','startDate'])assert.match(listed[field],/^\d{4}-\d{2}-\d{2}$/,`${field} is serialized as a date`);
  assert.match(listed.endDate,/^\d{4}-\d{2}-\d{2}$/,'endDate is serialized as a date');
  // Only one non-revoked Work Order may reference a quotation per branch; a second
  // creation and a PATCH re-pointing are rejected until that Work Order is revoked.
  await request('POST','/work-orders',basis,409);
  const basisCallsBeforePatch=quotationCalls;
  await request('PATCH','/work-orders/'+row.id,{version:0,inspectors:['Dewi'],quotationId:quoteId},409,'field');
  assert.equal(quotationCalls,basisCallsBeforePatch+1,'PATCH quotation basis is validated live before the duplicate-basis check');
  await request('POST','/work-orders',{...basis,endDate:undefined},400);
  await request('POST','/work-orders',{...basis,inspectors:undefined},400);
  await request('POST','/work-orders',{...basis,quotationId:randomUUID()},404);
  upstreamFails=true;await request('POST','/work-orders',raw,503);upstreamFails=false;
  const changed=await request('PATCH','/work-orders/'+row.id,{version:0,inspectors:['Dewi']},200,'field');
  assert.equal(changed.updatedByName,'Test User');assert.equal(changed.updatedById,user);assert.equal(changed.number,row.number);assert.deepEqual(changed.inspectors.map(x=>x.name),['Dewi']);assert.equal(changed.quotationId,null);
  await request('PATCH','/work-orders/'+row.id,{version:1,startDate:'2027-01-01',inspectors:['Should rollback']},400);
  assert.equal((await repo.get(row.id,actor)).version,1);assert.equal((await repo.get(row.id,actor)).inspectors[0].name,'Dewi');
  const races=await Promise.allSettled(Array.from({length:6},(_,i)=>repo.update(row.id,updateWorkOrderSchema.parse({version:1,startDate:['2026-09-16','2026-09-17','2026-09-18','2026-09-19','2026-09-20','2026-09-21'][i],inspectors:['Inspector '+i]}),null,actor)));
  assert.equal(races.filter(r=>r.status==='fulfilled').length,1);assert(races.filter(r=>r.status==='rejected').every(r=>r.reason.statusCode===409));
  const winner=await repo.get(row.id,actor);assert.equal(winner.startDate.toISOString().slice(0,10),winner.inspectors[0].name==='Inspector 2'?'2026-09-18':winner.startDate.toISOString().slice(0,10));
  contract.version=7;
  const cleared=await request('PATCH','/work-orders/'+row.id,{version:2,contractId,inspectors:[]});assert.equal(cleared.quotationSnapshot,null);assert.equal(cleared.quotationId,null);assert.equal(cleared.inspectors.length,0);
  assert.equal(cleared.contractSnapshot.version,7);
  // Explicit contract basis: contractId is validated through the contract reference endpoint; no version is submitted.
  contract.version=3;
  Object.assign(raw,{startDate:'2026-11-15',endDate:'2026-11-20'});
  const byContract=await request('POST','/work-orders',raw,201);
  assert.equal(byContract.status,'DRAFT');assert.equal(byContract.contractId,contractId);
  assert.equal(byContract.contractSnapshot.id,contractId);assert.equal(byContract.quotationId,null);
  assert(contractReferenceCalls>=1);
  await request('POST','/work-orders',{...raw,contractId:randomUUID()},404);
  await request('POST','/work-orders',{...raw,contractId:null},400);
  await request('POST','/work-orders',{...raw,quotationId:quoteId},400);
  const contractDetail=await request('GET','/work-orders/'+byContract.id);
  assert.equal(contractDetail.contractId,contractId);
  assert.deepEqual(contractDetail.contractSnapshot,byContract.contractSnapshot,'detail response retains stored contract snapshot');
  assert.equal((await request('GET','/work-orders?contractId='+contractId)).pagination.total,2);
  // ── Start flow: DRAFT -> IN_PROGRESS with live Marketing validation ────────
  // linked still holds quoteId, so the startable Work Order uses a second quotation.
  await seedQuotationSnapshotFor(startableQuoteId);
  // A different contract-priced quotation must still enforce inspector schedule conflicts.
  await request('POST','/work-orders',{...basis,quotationId:startableQuoteId},409,'valid',/inspectors have an overlapping work order/);
  const startable=await request('POST','/work-orders',{...basis,quotationId:startableQuoteId,startDate:'2026-12-15',endDate:'2026-12-20'},201);
  assert.equal(startable.status,'DRAFT');
  await request('POST','/work-orders/'+startable.id+'/start',{version:99},409);
  upstreamFails=true;
  await request('POST','/work-orders/'+startable.id+'/start',{version:0},503);
  upstreamFails=false;
  quotationHttpStatus=404;
  await request('POST','/work-orders/'+startable.id+'/start',{version:0},409);
  quotationHttpStatus=200;
  quotation.status='REVISED';
  await request('POST','/work-orders/'+startable.id+'/start',{version:0},409);
  quotation.status='APPROVED';
  quotation.version=1;
  await request('POST','/work-orders/'+startable.id+'/start',{version:0},409);
  quotation.version=0;
  assert.equal((await repo.get(startable.id,actor)).status,'DRAFT');
  const started=await request('POST','/work-orders/'+startable.id+'/start',{version:0});
  assert.equal(started.status,'IN_PROGRESS');assert.equal(started.version,1);
  assert.equal(started.updatedByName,'Test User');assert.equal(started.updatedById,user);
  const startHistory=await request('GET','/work-orders/'+startable.id+'/history');
  assert.equal(startHistory.pagination.total,2);
  assert.equal(startHistory.history[0].action,'START');
  assert.equal(startHistory.history[0].actionLabel,'Work order started');
  assert(startHistory.history[0].changes.some(change=>change.field==='status'&&change.before==='DRAFT'&&change.after==='IN_PROGRESS'));
  await request('POST','/work-orders/'+startable.id+'/start',{version:1},409);
  await request('POST','/work-orders/'+randomUUID()+'/start',{version:0},404);
  await request('POST','/work-orders/'+startable.id+'/start',{version:1},404,'other');
  // PATCH may not perform the start transition.
  await request('PATCH','/work-orders/'+byContract.id,{version:0,status:'IN_PROGRESS'},400);
  // Contract-based DRAFT starts without any Marketing quotation call.
  const quotationCallsBeforeStart=quotationCalls;
  const contractStarted=await request('POST','/work-orders/'+byContract.id+'/start',{version:0});
  assert.equal(contractStarted.status,'IN_PROGRESS');
  assert.equal(quotationCalls,quotationCallsBeforeStart,'contract basis must not call Marketing quotation reference');
  // Start flow: live Auth inspector validation before the transition. Stored
  // inspector snapshots must still match active FIELD_SERVICE users in the
  // authenticated branch; any drift leaves the Work Order in DRAFT.
  const authCallsBefore=authInspectorCalls;
  authInspectorFails=true;
  await request('POST','/work-orders/'+linked.id+'/start',{version:0},503);
  authInspectorFails=false;
  authInspectorMissing=[inspectorB];
  await request('POST','/work-orders/'+linked.id+'/start',{version:0},409);
  authInspectorMissing=null;
  authInspectorNames={[inspectorA]:'Renamed User'};
  await request('POST','/work-orders/'+linked.id+'/start',{version:0},409);
  authInspectorNames=null;
  assert(authInspectorCalls>=authCallsBefore+3,'start re-validates stored inspectors against Auth');
  assert.equal((await repo.get(linked.id,actor)).status,'DRAFT');
  const assertRevokeRejected=async(id,version,status,message,token='valid')=>{
   const before=await repo.get(id,actor);
   const history=await repo.history(id,1,100,actor);
   const callbacks=marketingCallbackCalls;
   await request('DELETE','/work-orders/'+id,{version},status,token,message);
   assert.deepEqual(await repo.get(id,actor),before,'Rejected revoke must not change the work order');
   assert.deepEqual(await repo.history(id,1,100,actor),history,'Rejected revoke must not write history');
   assert.equal(marketingCallbackCalls,callbacks,'Rejected revoke must not notify Marketing');
  };
  await assertRevokeRejected(linked.id,1,409,/reload before retrying/);
  await assertRevokeRejected(linked.id,0,404,/Work order not found/,'other');
  for(const status of ['COMPLETED','CANCELED']){
   await prisma.workOrder.update({where:{id:linked.id},data:{status}});
   await assertRevokeRejected(linked.id,0,409,/^Completed or canceled work orders cannot be revoked$/);
  }
  await prisma.workOrder.update({where:{id:linked.id},data:{status:'DRAFT'}});
  const callbacksBeforeRevoke=marketingCallbackCalls;
  const revoked=await request('DELETE','/work-orders/'+linked.id,{version:0});assert.equal(revoked.revoked,true);assert.equal(revoked.inspectors.length,2);
  assert.equal(marketingCallbackCalls,callbacksBeforeRevoke+1,'Marketing must be notified before revoke commits');
  assert.equal(marketingCallbackBodies.at(-1).workOrderId,linked.id);
  assert.equal(marketingCallbackBodies.at(-1).quotationId,quoteId);
  assert.equal(marketingCallbackBodies.at(-1).officeBranchId,branch);
  assert.equal(marketingCallbackBodies.at(-1).revoked,true);
  assert.equal((await request('GET','/work-orders/'+linked.id)).revoked,true);await request('PATCH','/work-orders/'+linked.id,{version:1,startDate:'2026-10-01'},409);
  await assertRevokeRejected(linked.id,1,409,/^Work order is already revoked$/);
  // Revoking linked frees quoteId: a new Work Order from the same quotation succeeds.
  const recreated=await request('POST','/work-orders',basis,201);assert.equal(recreated.quotationId,quoteId);assert.notEqual(recreated.id,linked.id);
  await request('POST','/work-orders',basis,409);
  assert.equal((await request('GET','/work-orders?revoked=true')).pagination.total,1);assert.equal((await request('GET','/work-orders?status=IN_PROGRESS')).pagination.total,2);assert.equal((await request('GET','/work-orders?quotationId='+quoteId)).pagination.total,1);
  const history=await request('GET','/work-orders/'+row.id+'/history?limit=2');
  assert.equal(history.pagination.total,4);assert.deepEqual(history.history.map(x=>x.version),[3,2]);
  assert.deepEqual(history.history[0].changes.find(x=>x.field==='inspectors').after,[]);
  assert.equal(history.history[0].beforeSnapshot.quotationId,null);
  assert.equal(history.history[0].snapshot.quotationId,null);
  const revokedHistory=await request('GET','/work-orders/'+linked.id+'/history');
  assert.equal(revokedHistory.pagination.total,2);assert.equal(revokedHistory.history[0].action,'REVOKE');
  assert.equal(revokedHistory.history[0].beforeSnapshot.revoked,false);assert.equal(revokedHistory.history[0].snapshot.revoked,true);
  let failHistory=true;
  prisma.$use(async(params,next)=>{if(failHistory&&params.model==='WorkOrderHistory'&&params.action==='create')throw Error('History unavailable');return next(params);});
  const stable=await repo.get(row.id,actor);
  const sequenceBefore=await prisma.workOrderSequence.findUnique({where:{officeBranchId_year:{officeBranchId:branch,year}}});
  Object.assign(raw,{startDate:'2027-01-15',endDate:'2027-01-20'});
  await assert.rejects(repo.create(createWorkOrderSchema.parse(raw),contract,actor),/History unavailable/);
  await assert.rejects(repo.update(row.id,updateWorkOrderSchema.parse({version:3,startDate:'2026-09-16',inspectors:['Rollback']}),null,actor),/History unavailable/);
  await assert.rejects(repo.revoke(row.id,3,actor),/History unavailable/);
  failHistory=false;
  assert.deepEqual(await repo.get(row.id,actor),stable);
  assert.equal((await repo.history(row.id,1,20,actor)).pagination.total,4);
  assert.equal((await prisma.workOrderSequence.findUnique({where:{officeBranchId_year:{officeBranchId:branch,year}}})).lastNumber,sequenceBefore.lastNumber);
  const created=await Promise.all(Array.from({length:6},(_,i)=>repo.create(createWorkOrderSchema.parse({...raw,startDate:`2027-02-${String(i+1).padStart(2,'0')}`,endDate:`2027-02-${String(i+1).padStart(2,'0')}`}),contract,actor)));
  assert.deepEqual(created.map(x=>x.number).sort(),Array.from({length:6},(_,i)=>`WO/${year}/${String(i+6).padStart(6,'0')}`));
  // Child insertion failure must roll back both Work order and number allocation.
  let fail=true;
  prisma.$use(async(params,next)=>{if(fail&&params.model==='WorkOrder'&&params.action==='create')params.args.data.inspectors.create.push({name:'x'.repeat(256),position:999});return next(params);});
  await assert.rejects(repo.create(createWorkOrderSchema.parse(raw),contract,actor));fail=false;
  assert.equal((await repo.create(createWorkOrderSchema.parse(raw),contract,actor)).number,`WO/${year}/000012`);
  const allocate=clock=>prisma.$transaction(tx=>nextWorkOrderIdentity(tx,clockBranch,clock));
  const end=()=>new Date('2026-12-31T16:59:59Z'),start=()=>new Date('2026-12-31T17:00:00Z');
  assert.equal((await allocate(end)).number,'WO/2026/000001');assert.equal((await allocate(end)).number,'WO/2026/000002');assert.equal((await allocate(start)).number,'WO/2027/000001');
  let reads=0;const crossed=await allocate(()=>++reads===1?end():start());assert.equal(crossed.number,'WO/2027/000002');assert.equal(crossed.date.toISOString(),'2027-01-01T00:00:00.000Z');
  await prisma.workOrderSequence.delete({where:{officeBranchId_year:{officeBranchId:branch,year}}});
  Object.assign(raw,{startDate:'2027-03-15',endDate:'2027-03-20'});
  assert.equal((await repo.create(createWorkOrderSchema.parse(raw),contract,actor)).number,`WO/${year}/000013`);
  const inProgress=await request('GET','/work-orders/'+byContract.id);
  assert.equal(inProgress.status,'IN_PROGRESS');
  const callbacksBeforeContractRevoke=marketingCallbackCalls;
  const revokedInProgress=await request('DELETE','/work-orders/'+byContract.id,{version:inProgress.version});
  assert.equal(revokedInProgress.revoked,true);
  assert.equal(revokedInProgress.version,inProgress.version+1);
  assert.equal(revokedInProgress.status,'IN_PROGRESS');
  assert.equal((await repo.history(byContract.id,1,20,actor)).history[0].action,'REVOKE');
  assert.equal(marketingCallbackCalls,callbacksBeforeContractRevoke);
 }finally{
  global.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));
  const where={officeBranchId:{in:branches}};
  await prisma.workOrderHistory.deleteMany({where:{workOrder:where}});
  await prisma.workOrderInspector.deleteMany({where:{workOrder:where}});await prisma.workOrder.deleteMany({where});await prisma.workOrderSequence.deleteMany({where});
  await prisma.fieldServiceUser.deleteMany({where:{id:{in:[inspectorA,inspectorB,foreignInspector]}}});await prisma.$disconnect();
 }
});
