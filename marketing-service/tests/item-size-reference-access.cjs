const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {randomUUID}=require('node:crypto');
const {prisma}=require('../dist/config/db.js');
const routes=require('../dist/routes/index.js').default;
test('item size reference permits Field Service reads, scopes branch and returns catalog scopes',async()=>{
 const branch=randomUUID(),foreign=randomUUID(),user=randomUUID();
 let service,item,size,standalone;
 const originalFetch=global.fetch;
 let profile={id:user,officeBranchId:branch,isActive:true,role:'USER',section:'FIELD_SERVICE'};
 global.fetch=async()=>({ok:true,json:async()=>({data:profile})});
 const app=express();app.use((req,res,next)=>{req.user={sub:user,officeBranchId:profile.officeBranchId};next();});app.use(routes);
 app.use((error,req,res,next)=>res.status(error.statusCode||500).json({message:error.message}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const get=path=>originalFetch(`http://127.0.0.1:${server.address().port}${path}`,{headers:{authorization:'Bearer test','x-user-id':user,'x-office-branch-id':profile.officeBranchId}});
 try{
  service=await prisma.service.create({data:{officeBranchId:branch,name:'Ref Service',type:'TUBULAR',hasMaintenance:true,createdById:user,createdByName:'Reference Test'}});
  await prisma.serviceScope.createMany({data:[
   {serviceId:service.id,type:'INSPECTION',scope:'Visual Inspection'},
   {serviceId:service.id,type:'MAINTENANCE',scope:'Cleaning'}]});
  item=await prisma.item.create({data:{officeBranchId:branch,name:'Ref Pipe',uom:'PCS',serviceId:service.id,createdById:user,createdByName:'Reference Test'}});
  size=await prisma.itemSize.create({data:{itemId:item.id,size:'Large',createdById:user,createdByName:'Reference Test'}});
  standalone=await prisma.item.create({data:{officeBranchId:branch,name:'Ref Bolt',uom:'PCS',createdById:user,createdByName:'Reference Test'}});
  const standaloneSize=await prisma.itemSize.create({data:{itemId:standalone.id,size:null,createdById:user,createdByName:'Reference Test'}});
  await prisma.serviceScope.create({data:{itemId:standalone.id,type:'INSPECTION',scope:'Thread Check'}});

  const result=await get('/item-size-references/'+size.id);
  assert.equal(result.status,200);
  const data=(await result.json()).data;
  assert.equal(data.itemSizeId,size.id);
  assert.equal(data.serviceName,'Ref Service');
  assert.equal(data.inspectionScope,'Visual Inspection');
  assert.equal(data.maintenanceScope,'Cleaning');
  assert.equal(data.itemName,'Ref Pipe');
  assert.equal(data.size,'Large');

  // A standalone item owns its scopes and has no service.
  const own=await get('/item-size-references/'+standaloneSize.id);
  assert.equal(own.status,200);
  const ownData=(await own.json()).data;
  assert.equal(ownData.serviceName,'Ref Bolt');
  assert.equal(ownData.inspectionScope,'Thread Check');
  assert.equal(ownData.maintenanceScope,'');
  assert.equal(ownData.size,null);

  assert.equal((await get('/item-size-references/not-a-uuid')).status,400);
  assert.equal((await get('/item-size-references/'+randomUUID())).status,404);
  // Another branch never sees the size.
  profile.officeBranchId=foreign;
  assert.equal((await get('/item-size-references/'+size.id)).status,404);
  profile.officeBranchId=branch;
  // A revoked scope never reaches the snapshot.
  await prisma.serviceScope.updateMany({where:{serviceId:service.id,type:'MAINTENANCE'},data:{revoked:true}});
  const revoked=await get('/item-size-references/'+size.id);
  assert.equal((await revoked.json()).data.maintenanceScope,'');
  await prisma.serviceScope.updateMany({where:{serviceId:service.id,type:'MAINTENANCE'},data:{revoked:false}});
  // An inactive size or item is rejected.
  await prisma.itemSize.update({where:{id:size.id},data:{isActive:false}});
  assert.equal((await get('/item-size-references/'+size.id)).status,409);
  await prisma.itemSize.update({where:{id:size.id},data:{isActive:true}});
  await prisma.item.update({where:{id:item.id},data:{isActive:false}});
  assert.equal((await get('/item-size-references/'+size.id)).status,409);
 }finally{
  global.fetch=originalFetch;await new Promise(resolve=>server.close(resolve));
  if(standalone)await prisma.item.delete({where:{id:standalone.id}});
  if(item)await prisma.item.delete({where:{id:item.id}});
  if(service)await prisma.service.delete({where:{id:service.id}});
  await prisma.$disconnect();
 }
});

