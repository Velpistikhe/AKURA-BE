const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const express=require('express');
require('dotenv').config();
const {env}=require('../dist/config/env.js');
const {errorHandler}=require('../dist/middlewares/error.middleware.js');
require('../dist/utils/logger.js').logger.silent=true;
const routes=require('../dist/modules/work-orders/work-order.routes.js').default;
test('Create requires MARKETING section for every role',async(t)=>{
 const branch=randomUUID(),id=randomUUID();
 const profile={id,officeBranchId:branch,isActive:true,role:'USER',section:'MARKETING',firstName:'Test',lastName:'User',username:'test'};
 const originalFetch=global.fetch;let upstreamCalls=0;
 global.fetch=async(url,options)=>{
  if(String(url)===env.API_GATEWAY_URL+'/api/v1/auth/me')return {ok:true,json:async()=>({data:profile})};
  upstreamCalls++;throw Error('Creation must not load references for an unauthorized actor');
 };
 const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={sub:id,officeBranchId:branch};next();});app.use('/work-orders',routes);app.use(errorHandler);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 t.after(async()=>{global.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));});
 for(const role of ['USER','ADMIN','APP_MANAGER'])for(const section of ['MARKETING','FIELD_SERVICE','FINANCE','ACCOUNTING','HRD_MANAGEMENT',null]){
  profile.role=role;profile.section=section;
  const response=await originalFetch(`http://127.0.0.1:${server.address().port}/work-orders`,{method:'POST',headers:{authorization:'Bearer valid','content-type':'application/json'},body:'{}'});
  assert.equal(response.status,section==='MARKETING'?400:403,JSON.stringify({role,section,body:await response.json()}));
 }
 assert.equal(upstreamCalls,0);
});
