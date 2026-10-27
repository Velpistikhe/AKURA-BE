const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {Prisma}=require('@prisma/client');
require('dotenv').config();
const {prisma}=require('../dist/config/db.js');
const {resolveBillingPrices,billingPricesSchema}=require('../dist/modules/items/billing-prices.js');

test('billing batch uses company prices, contract fallback and a consistent branch-scoped read',async(t)=>{
 const branch=randomUUID(),companyId=randomUUID(),sizeId=randomUUID(),contractId=randomUUID();
 const company={id:companyId,name:'Customer',isSisterCompany:false};let contract=null;
 const decimal=value=>new Prisma.Decimal(value);
 const row={id:sizeId,isActive:true,version:1,size:null,item:{id:randomUUID(),name:'Tank',isActive:true,version:1,service:{officeBranchId:branch,name:'Inspection',type:'INSPECTION',hasMaintenance:true,isActive:true,version:1}},
 price:{id:randomUUID(),version:1,isActive:true,effectiveFrom:new Date('2020-01-01'),effectiveUntil:null,priceServicePrimary:decimal(100),priceMaintenancePrimary:decimal(50),priceServiceSisterCompany:decimal(80),priceMaintenanceSisterCompany:decimal(40)},contractPrices:[]};
 let missing=false;
 const tx={company:{findFirst:async args=>{assert.equal(args.where.officeBranchId,branch);return missing?null:company;}},companyContract:{findMany:async args=>{assert.equal(args.where.company.officeBranchId,branch);assert.equal(args.where.status,'APPROVED');return contract?[contract]:[];}},itemSize:{findMany:async args=>{assert.equal(args.where.item.officeBranchId,branch);assert.deepEqual(args.where.id.in,[sizeId]);return [row];}}};
 const original=prisma.$transaction;
 t.after(()=>{prisma.$transaction=original;});
 prisma.$transaction=async(fn,options)=>{assert.equal(options.isolationLevel,'RepeatableRead');return fn(tx);};
 const input={companyId,itemSizeIds:[sizeId]};
 assert.equal(billingPricesSchema.safeParse({...input,itemSizeIds:[sizeId,sizeId]}).success,false);
 let result=await resolveBillingPrices(input,branch);assert.equal(result.items[0].priceSource,'PRIMARY');assert.equal(result.items[0].priceInspection.toString(),'100');
 company.isSisterCompany=true;result=await resolveBillingPrices(input,branch);assert.equal(result.items[0].priceSource,'SISTER_COMPANY');assert.equal(result.items[0].priceInspection.toString(),'80');
 contract={id:contractId,version:2};row.contractPrices=[{id:randomUUID(),contractId,version:3,isActive:true,effectiveFrom:new Date('2020-01-01'),effectiveUntil:null,priceService:decimal(70),priceMaintenance:decimal(35)}];
 result=await resolveBillingPrices(input,branch);assert.equal(result.items[0].priceSource,'CONTRACT');assert.equal(result.items[0].priceInspection.toString(),'70');assert.equal(result.items[0].contractVersion,2);
 row.contractPrices[0].isActive=false;result=await resolveBillingPrices(input,branch);assert.equal(result.items[0].priceSource,'SISTER_COMPANY');
 row.isActive=false;await assert.rejects(()=>resolveBillingPrices(input,branch),e=>e.statusCode===409);row.isActive=true;
 row.item.service.officeBranchId=randomUUID();await assert.rejects(()=>resolveBillingPrices(input,branch),e=>e.statusCode===404);row.item.service.officeBranchId=branch;
 missing=true;await assert.rejects(()=>resolveBillingPrices(input,branch),e=>e.statusCode===404);
});
