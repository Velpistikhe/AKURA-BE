const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const express=require('express');
require('dotenv').config();
const {env}=require('../dist/config/env.js');
const routes=require('../dist/modules/work-orders/work-order.routes.js').default;
const {workOrderRepository:repo}=require('../dist/modules/work-orders/work-order.repository.js');
const {errorHandler}=require('../dist/middlewares/error.middleware.js');

test('Work Order reference accepts billing sections without expanding general access',async(t)=>{
 const branch=randomUUID(),otherBranch=randomUUID(),id=randomUUID(),quotationId=randomUUID();
 const profile={id,officeBranchId:branch,isActive:true,role:'USER',section:'MARKETING',firstName:'Test',lastName:'User',username:'test'};
 const originalFetch=global.fetch,originalLookup=repo.findActiveByQuotation,originalList=repo.list;
 let calls=0;
 global.fetch=async(url,options)=>{
  if(String(url)===env.API_GATEWAY_URL+'/api/v1/auth/me')return {ok:true,json:async()=>({data:profile})};
  return originalFetch(url,options);
 };
 repo.findActiveByQuotation=async(quote,actor)=>{calls++;assert.equal(quote,quotationId);return actor.officeBranchId===branch?{id:randomUUID(),quotationId,officeBranchId:branch,status:'COMPLETED'}:null;};
 repo.list=async()=>({documents:[]});
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={sub:id,officeBranchId:req.headers['x-test-branch']||branch};next();});app.use('/work-orders',routes);app.use(errorHandler);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 t.after(async()=>{global.fetch=originalFetch;repo.findActiveByQuotation=originalLookup;repo.list=originalList;await new Promise(resolve=>server.close(resolve));});
 const request=async(method,path,expected,selectedBranch=branch)=>{const response=await originalFetch(`http://127.0.0.1:${server.address().port}/work-orders${path}`,{method,headers:{authorization:'Bearer valid','content-type':'application/json','x-test-branch':selectedBranch},...(method==='POST'?{body:'{}'}:{})});const body=await response.json();assert.equal(response.status,expected,JSON.stringify(body));return body;};
 for(const section of ['MARKETING','FIELD_SERVICE','FINANCE','ACCOUNTING']){
  profile.section=section;assert.equal((await request('GET','/by-quotation/'+quotationId,200)).data.officeBranchId,branch);
  if(['FINANCE','ACCOUNTING'].includes(section)){await request('GET','',403);await request('POST','',403);await request('POST','/'+randomUUID()+'/start',403);}
 }
 profile.section='HRD_MANAGEMENT';const before=calls;await request('GET','/by-quotation/'+quotationId,403);assert.equal(calls,before);
 profile.section='MARKETING';profile.officeBranchId=otherBranch;assert.equal((await request('GET','/by-quotation/'+quotationId,200,otherBranch)).data,null);
 await request('GET','/by-quotation/'+quotationId,401);
 profile.officeBranchId=branch;profile.isActive=false;await request('GET','/by-quotation/'+quotationId,403);
});
