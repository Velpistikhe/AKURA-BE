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
 const profile={id:user,officeBranchId:branch,isActive:true,role:'USER',section:'FIELD_SERVICE',firstName:'Test',lastName:'User',username:'test'};
 const quotation={id:quoteId,officeBranchId:branch,version:0,isActive:true,no:1,numberYear:2026,subject:'Work',companySnapshot:{name:'Company'},customerSnapshot:'Buyer',subTotal:'100',taxAmount:'11',total:'111',items:[]};
 const originalFetch=global.fetch;
 global.fetch=async(url,options)=>{
  if(!String(url).startsWith(env.API_GATEWAY_URL+'/api/v1/')) return originalFetch(url,options);
  const token=options.headers.Authorization;
  if(String(url).endsWith('/auth/me')) return {ok:true,json:async()=>({data:{...profile,...(token==='Bearer other'?{officeBranchId:otherBranch}:{}),...(token==='Bearer inactive'?{isActive:false}:{}),...(token==='Bearer wrong-section'?{section:'HRD_MANAGEMENT'}:{})}})};
  if(String(url).endsWith('/quotation-references/'+quoteId)) return {ok:true,json:async()=>({data:quotation})};
  throw Error('Unexpected upstream call');
 };
 const app=express();app.use(express.json());
 app.use((req,res,next)=>{req.user={sub:user,type:'access',officeBranchId:req.headers.authorization==='Bearer other'?otherBranch:req.headers.authorization==='Bearer stale'?otherBranch:branch};next();});
 app.use(routes);app.use(errorHandler);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const request=async(method,path,body,status=200,token='valid')=>{const r=await originalFetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{'content-type':'application/json',authorization:'Bearer '+token,'x-office-branch-id':otherBranch},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await r.json();assert.equal(r.status,status,JSON.stringify(result));return result.data;};
 try {
  const modules=['/reports'];
  let first;
  for(const module of modules){
   const raw={number:'HTTP-001',quotationId:quoteId,quotationVersion:0,title:'HTTP Document',date:'2026-09-12',content:'Completed field inspection'};
   await request('POST',module,{...raw,officeBranchId:otherBranch},400);
   await request('POST',module,{...raw,quotationVersion:1},409);
   await request('POST',module,raw,404,'other');
   const row=await request('POST',module,raw,201);
   assert.equal(row.officeBranchId,branch);assert.equal(row.createdByName,'Test User');
   if(first)await request('GET',module+'/'+first,undefined,404);
   first=row.id;
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
  const where={officeBranchId:branch};await prisma.documentHistory.deleteMany({where:{document:where}});await prisma.document.deleteMany({where});await prisma.$disconnect();
 }
});
