// Run after prisma db push with old application writers stopped.
require('dotenv').config();
const {PrismaClient}=require('@prisma/client');
const prisma=new PrismaClient();
(async()=>{
 try {
  const updated=await prisma.$executeRaw`UPDATE quotation_items SET
    quantity_maintenance = CASE WHEN price_selection->>'priceKind' = 'MAINTENANCE' THEN quantity ELSE 0 END,
    price_maintenance = CASE WHEN price_selection->>'priceKind' = 'MAINTENANCE' THEN unit_price ELSE NULL END,
    quantity = CASE WHEN price_selection->>'priceKind' = 'MAINTENANCE' THEN 0 ELSE quantity END,
    unit_price = CASE WHEN price_selection->>'priceKind' = 'MAINTENANCE' THEN 0 ELSE unit_price END,
    price_selection = COALESCE(price_selection, '{}'::jsonb) || '{"quantityModel":"DUAL"}'::jsonb
    WHERE price_selection->>'quantityModel' IS DISTINCT FROM 'DUAL'`;
  console.log(`Normalized ${updated} legacy quotation lines; historical snapshots preserved.`);
 } finally {await prisma.$disconnect();}
})().catch(error=>{console.error(error.message);process.exitCode=1;});
