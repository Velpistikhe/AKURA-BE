const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const express=require('express');
require('dotenv').config();
const {env}=require('../dist/config/env.js');
const {documentRepository:repo}=require('../dist/modules/documents/document.repository.js');
const routes=require('../dist/routes/index.js').default;
const {errorHandler}=require('../dist/middlewares/error.middleware.js');
require('../dist/utils/logger.js').logger.silent=true;
test('Marketing may list invoices in actor branch without gaining other Finance access',async(t)=>{
 const branch=randomUUID(),other=randomUUID(),id=randomUUID();
 const profile={id,officeBranchId:branch,isActive:true,role:'USER',section:'MARKETING',firstName:'Test',lastName:'User',username:'test'};
 const originalFetch=global.fetch,originalList=repo.list;let calls=0;
 global.fetch=async(url,options)=>{if(String(url)===env.API_GATEWAY_URL+'/api/v1/auth/me')return {ok:true,json:async()=>({data:profile})};throw Error('Unexpected upstream');};
 repo.list=async(kind,input,actor)=>{calls++;assert.equal(kind,'INVOICE');assert.equal(actor.officeBranchId,profile.officeBranchId);return {documents:[],pagination:{page:input.page,limit:input.limit,total:0,totalPages:0}};};
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={sub:id,officeBranchId:req.headers['x-test-branch']||branch};next();});app.use(routes);app.use(errorHandler);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 t.after(async()=>{global.fetch=originalFetch;repo.list=originalList;await new Promise(resolve=>server.close(resolve));});
 const request=async(method,path,status,selectedBranch=branch)=>{const r=await originalFetch(`http://127.0.0.1:${server.address().port}${path}`,{method,headers:{authorization:'Bearer valid','content-type':'application/json','x-test-branch':selectedBranch,'x-office-branch-id':other},...(method==='GET'?{}:{body:'{}'})});assert.equal(r.status,status,await r.text());};
 for(const section of ['MARKETING','FINANCE','ACCOUNTING']){profile.section=section;await request('GET','/invoices?page=2&limit=5',200);}
 profile.section='MARKETING';
 await request('GET','/proforma-invoices',403);await request('GET','/invoices/'+randomUUID(),403);await request('GET','/invoices/'+randomUUID()+'/history',403);await request('POST','/invoices/'+randomUUID()+'/approve',403);await request('PATCH','/invoices/'+randomUUID(),403);
 profile.officeBranchId=other;await request('GET','/invoices',200,other);await request('GET','/invoices',401);
 profile.officeBranchId=branch;profile.section='HRD_MANAGEMENT';await request('GET','/invoices',403);
 profile.section='MARKETING';profile.isActive=false;await request('GET','/invoices',403);
 assert.equal(calls,4);
});
