const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {requireMarketingAccess,requireQuotationReferenceAccess}=require('../dist/middlewares/authorize.middleware.js');
test('downstream quotation reference access stays read-only and branch-bound',async()=>{
 const id=randomUUID(),branch=randomUUID();
 const originalFetch=global.fetch;
 let profile={id,officeBranchId:branch,isActive:true,role:'USER',section:'FINANCE'};
 global.fetch=async()=>({ok:true,json:async()=>({data:profile})});
 async function invoke(middleware){
  let status=200,passed=false;
  const req={headers:{authorization:'Bearer test','x-user-id':id,'x-user-role':'USER','x-office-branch-id':branch},user:{sub:id,role:'USER',officeBranchId:branch}};
  const res={locals:{},status(code){status=code;return this;},json(){return this;}};
  await middleware(req,res,()=>{passed=true;});return {status,passed};
 }
 try {
  for(const section of ['FINANCE','ACCOUNTING','FIELD_SERVICE']){profile.section=section;assert.equal((await invoke(requireQuotationReferenceAccess)).passed,true);assert.equal((await invoke(requireMarketingAccess)).status,403);}
  profile.section='HRD_MANAGEMENT';assert.equal((await invoke(requireQuotationReferenceAccess)).status,403);
  profile.section='FINANCE';profile.officeBranchId=randomUUID();assert.equal((await invoke(requireQuotationReferenceAccess)).status,401);
  profile.officeBranchId=branch;profile.isActive=false;assert.equal((await invoke(requireQuotationReferenceAccess)).status,403);
 }finally{global.fetch=originalFetch;}
});
