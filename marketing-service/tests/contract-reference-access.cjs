const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {randomUUID}=require('node:crypto');
const {prisma}=require('../dist/config/db.js');
const routes=require('../dist/routes/index.js').default;
test('contract reference permits Field Service reads, scopes branch and excludes revoked companies',async()=>{
 const branch=randomUUID(),user=randomUUID(),foreign=randomUUID();
 let company,contract,duplicate;
 const originalFetch=global.fetch;
 let profile={id:user,officeBranchId:branch,isActive:true,role:'USER',section:'FIELD_SERVICE'};
 global.fetch=async()=>({ok:true,json:async()=>({data:profile})});
 const app=express();app.use((req,res,next)=>{req.user={sub:user,officeBranchId:profile.officeBranchId};next();});app.use(routes);
 app.use((error,req,res,next)=>res.status(error.statusCode||500).json({message:error.message}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const get=path=>originalFetch(`http://127.0.0.1:${server.address().port}${path}`,{headers:{authorization:'Bearer test','x-user-id':user,'x-office-branch-id':profile.officeBranchId}});
 try{
  company=await prisma.company.create({data:{officeBranchId:branch,name:'Reference test',normalizeName:branch,type:'PT',npwp:'1',address:'Jakarta'}});
  contract=await prisma.companyContract.create({data:{companyId:company.id,contractNumber:'TEST',contractDate:new Date(),effectiveFrom:new Date('2000-01-01'),effectiveUntil:new Date('2099-01-01'),status:'ACTIVE',createdById:user}});
  const result=await get('/contract-references/'+contract.id);assert.equal(result.status,200);const data=(await result.json()).data;assert.equal(data.company.officeBranchId,branch);assert.equal(data.id,contract.id);
  const path='/company-contract-references/'+company.id;
  const resolved=await get(path);assert.equal(resolved.status,200);assert.equal((await resolved.json()).data.id,contract.id);
  assert.equal((await get('/company-contract-references/not-a-uuid')).status,400);
  assert.equal((await get('/company-contract-references/'+randomUUID())).status,404);
  for(const change of [{status:'CREATE'},{isActive:false},{effectiveFrom:new Date('2098-01-01')},{effectiveUntil:new Date('2000-01-02')},{effectiveUntil:require('../dist/utils/businessDate.js').currentBusinessDate()}]){
   await prisma.companyContract.update({where:{id:contract.id},data:change});
   assert.equal((await get(path)).status,409);
   await prisma.companyContract.update({where:{id:contract.id},data:{status:'ACTIVE',isActive:true,effectiveFrom:new Date('2000-01-01'),effectiveUntil:new Date('2099-01-01')}});
  }
  duplicate=await prisma.companyContract.create({data:{companyId:company.id,contractNumber:'DUPLICATE',contractDate:new Date(),effectiveFrom:new Date('2000-01-01'),effectiveUntil:new Date('2099-01-01'),status:'ACTIVE',createdById:user}});
  assert.equal((await get(path)).status,409);
  await prisma.companyContract.delete({where:{id:duplicate.id}});duplicate=null;
  assert.equal((await get('/company-contracts/'+contract.id)).status,403);
  profile.officeBranchId=foreign;assert.equal((await get('/contract-references/'+contract.id)).status,404);
  assert.equal((await get(path)).status,404);
  profile.officeBranchId=branch;profile.section='HRD_MANAGEMENT';assert.equal((await get('/contract-references/'+contract.id)).status,403);
  assert.equal((await get(path)).status,403);
  profile.section='FIELD_SERVICE';await prisma.company.update({where:{id:company.id},data:{revoked:true}});assert.equal((await get('/contract-references/'+contract.id)).status,404);
  assert.equal((await get(path)).status,404);
 }finally{
  global.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));
  if(duplicate)await prisma.companyContract.delete({where:{id:duplicate.id}});
  if(contract)await prisma.companyContract.delete({where:{id:contract.id}});if(company)await prisma.company.delete({where:{id:company.id}});await prisma.$disconnect();
 }
});
