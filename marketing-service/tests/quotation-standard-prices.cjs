const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {prisma}=require('../dist/config/db.js');const {itemRepository}=require('../dist/modules/items/item.repository.js');const {quotationRepository}=require('../dist/modules/quotations/quotation.repository.js');
async function main(){const branch=randomUUID(),otherBranch=randomUUID(),actor={id:randomUUID(),name:'Standard quotation test'},audit={createdById:actor.id,createdByName:actor.name};const branches=[branch,otherBranch];
try{
const companies=[];for(const b of [branch,branch,otherBranch])companies.push(await prisma.company.create({data:{officeBranchId:b,name:'Customer',normalizeName:randomUUID(),type:'PT',npwp:'1',address:'Jakarta'}}));const [company,otherCompany,foreign]=companies;
const svc=await prisma.service.create({data:{officeBranchId:branch,name:'Inspection',type:'TUBULAR',hasMaintenance:true,...audit}});
const item=await prisma.item.create({data:{officeBranchId:branch,serviceId:svc.id,name:'Pipe',...audit}});const sizes=[];
for(const label of ['Contract','Standard','Other company','Other branch','Unavailable'])sizes.push(await prisma.itemSize.create({data:{itemId:item.id,size:label,...audit,price:label==='Unavailable'?undefined:{create:{priceServicePrimary:'100',priceServiceSisterCompany:'80',priceMaintenancePrimary:'20',priceMaintenanceSisterCompany:'10',...audit}}}}));
const contracts=[];for(const c of companies)contracts.push(await prisma.companyContract.create({data:{companyId:c.id,contractNumber:randomUUID(),contractDate:new Date('2020-01-01'),effectiveFrom:new Date('2020-01-01'),effectiveUntil:new Date('2099-01-01'),status:'ACTIVE',createdById:actor.id}}));
for(const [idx,size]of [[0,sizes[0]],[1,sizes[2]],[2,sizes[3]]])await prisma.companyContractPrice.create({data:{contractId:contracts[idx].id,itemSizeId:size.id,priceService:'7',priceMaintenance:'3',catalogSnapshot:{serviceName:'Contract identity',serviceType:'TUBULAR',itemName:'Old pipe',size:size.size,hasMaintenance:true},...audit}});
const input={page:1,limit:100};const options=(extra={},b=branch,c=company.id)=>itemRepository.listSizes({...input,...extra},b,c,true);
let result=await options();assert.deepEqual(new Set(result.sizes.map(x=>x.id)),new Set(sizes.slice(1).map(x=>x.id)));assert.equal(result.pagination.total,4);assert(result.sizes.every(x=>x.priceSource==='PRIMARY'&&x.contractId===null));
assert.equal((await options({size:'Contract'})).pagination.total,0);assert.equal((await options({notIn:[sizes[1].id],limit:1})).pagination.total,3);
assert.equal((await options({},branch,otherCompany.id)).sizes.some(x=>x.id===sizes[0].id),true);
await assert.rejects(options({},otherBranch,company.id),e=>e.statusCode===404);
// A disabled contract price is still a member of the current contract and remains excluded.
await prisma.companyContractPrice.updateMany({where:{contractId:contracts[0].id},data:{isActive:false}});assert.equal((await options()).sizes.some(x=>x.id===sizes[0].id),false);
await prisma.taxCache.create({data:{id:randomUUID(),officeBranchId:branch,percentage:'11',effectiveFrom:new Date('2000-01-01'),sourceUpdatedAt:new Date()}});
const quoteInput={companyId:company.id,inquiryMethod:'EMAIL',inquiryDate:'2026-01-01',subject:'Normal pricing',termOfPayment:'30 days',validity:'30 days',supplyAkura:'Tools',supplyCustomer:'Access',location:'Jakarta',accomplished:'7 days',deliveryReports:'PDF',items:[{itemSizeId:sizes[1].id,quantityInspection:'2',quantityMaintenance:'1'}]};
const q=await quotationRepository.create(quoteInput,branch,actor);assert.equal(q.items[0].priceInspection.toString(),'100');assert.equal(q.items[0].priceMaintenance.toString(),'20');assert.equal(q.subTotal.toString(),'220');assert.equal(q.items[0].priceSelection.priceSource,'PRIMARY');
// Even a directly supplied contracted size must never resolve a contract price.
const direct=await quotationRepository.create({...quoteInput,items:[{itemSizeId:sizes[0].id,quantityInspection:'1'}]},branch,actor);assert.equal(direct.items[0].priceInspection.toString(),'100');assert.equal(direct.items[0].itemName,'Pipe');assert.equal(direct.items[0].priceSelection.contractId,null);
await prisma.company.update({where:{id:company.id},data:{isSisterCompany:true}});result=await options();assert.equal(result.sizes.find(x=>x.id===sizes[1].id).priceService.toString(),'80');
const sister=await quotationRepository.create(quoteInput,branch,actor);assert.equal(sister.items[0].priceInspection.toString(),'80');assert.equal(sister.items[0].priceMaintenance.toString(),'10');assert.equal(sister.subTotal.toString(),'170');assert.equal(sister.items[0].priceSelection.priceSource,'SISTER_COMPANY');
await assert.rejects(quotationRepository.create({...quoteInput,items:[{itemSizeId:sizes[4].id,quantityInspection:'1'}]},branch,actor),e=>e.statusCode===409);
await prisma.companyContract.update({where:{id:contracts[0].id},data:{status:'EXPIRED'}});assert.equal((await options()).sizes.some(x=>x.id===sizes[0].id),true);
await prisma.itemSize.update({where:{id:sizes[0].id},data:{isActive:false}});assert.equal((await options()).sizes.some(x=>x.id===sizes[0].id),false);await assert.rejects(quotationRepository.create({...quoteInput,items:[{itemSizeId:sizes[0].id,quantityInspection:'1'}]},branch,actor),e=>e.statusCode===409);
assert.equal((await quotationRepository.find(q.id,branch)).items[0].priceInspection.toString(),'100');
console.log('PASS: selected-company contract exclusion, branch isolation, search/pagination/exclude, contract lifecycle, normal/sister creation and preserved snapshots');
}finally{const where={officeBranchId:{in:branches}};await prisma.quotationHistory.deleteMany({where:{quotation:where}});await prisma.quotationItem.deleteMany({where:{quotation:where}});await prisma.quotation.deleteMany({where});await prisma.taxCache.deleteMany({where});await prisma.companyContractPrice.deleteMany({where:{contract:{company:where}}});await prisma.company.deleteMany({where});await prisma.service.deleteMany({where});await prisma.$disconnect()}}
main().catch(e=>{console.error(e);process.exitCode=1});
