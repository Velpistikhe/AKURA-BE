const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const ExcelJS = require('exceljs');
const { prisma } = require('../dist/config/db.js');
const { createPriceWorkbook, parsePriceWorkbook } = require('../dist/modules/contracts/contract-excel.workbook.js');
const { contractExcelRepository: repository } = require('../dist/modules/contracts/contract-excel.repository.js');
const { itemWriteRepository } = require('../dist/modules/items/item-write.repository.js');

async function main() {
  const branch = randomUUID(), actor = { id: randomUUID(), name: 'Excel Test' };
  const service = { id: randomUUID(), name: 'Inspection', type: 'TUBULAR', isActive: true, hasMaintenance: true };
  const size = (name, svc = null, label = null) => ({ id: randomUUID(), itemId: randomUUID(), size: label, version: 2, isActive: true,
    item: { id: randomUUID(), name, service: svc, version: 1, isActive: true },
    price: { id: randomUUID(), version: 1, isActive: true, effectiveFrom: new Date('2020-01-01'), effectiveUntil: null, priceServicePrimary: '100.25', priceMaintenancePrimary: svc ? '20' : null },
  });
  const sizes = [size('Pipe', service, 'Large'), size('Adapter'), size('Valve')];
  let exportQuery;
  prisma.itemSize.findMany = async query => { exportQuery = query; return sizes; };
  await repository.exportSizes({ sortOrder: 'desc' }, branch);
  assert.deepEqual(exportQuery.orderBy, [{ item: { service: { name: 'asc' } } }, { item: { name: 'asc' } }, { size: 'asc' }, { id: 'asc' }]);
  assert.equal(exportQuery.include.price.select.version, undefined);
  await repository.exportSizes({ sortBy: 'size', sortOrder: 'desc' }, branch);
  assert.deepEqual(exportQuery.orderBy, [{ size: 'desc' }, { id: 'asc' }]);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await createPriceWorkbook(sizes, branch));
  const sheet = workbook.getWorksheet('Normal Prices');
  assert.equal(sheet.rowCount, 8);
  assert.deepEqual(sheet.getRow(5).values.slice(1), ['Service', 'Item', 'Size', 'Service Price', 'Maintenance Price', 'Item Size ID', 'Size Version']);
  assert.equal(sheet.columnCount, 7);
  assert.equal(sheet.getColumn(1).width, 28);
  assert.equal(sheet.getColumn(2).width, 32);
  assert.equal(sheet.getCell('A7').value, null);
  assert.equal(sheet.getCell('B7').value, 'Adapter');
  assert.equal(sheet.getColumn(6).hidden, true);
  assert.equal(sheet.getColumn(7).hidden, true);
  assert.equal(sheet.sheetProtection.sheet, true);
  assert.notEqual(sheet.sheetProtection.formatColumns, true);
  for (let row = 6; row <= 8; row++) {
    for (let col = 1; col <= 7; col++) assert.equal(sheet.getRow(row).getCell(col).protection?.locked !== false, ![4, 5].includes(col));
  }
  assert.equal(workbook.getWorksheet('Instructions').sheetProtection.sheet, true);
  assert.equal(workbook.getWorksheet('_Template').state, 'veryHidden');
  const parse = async () => parsePriceWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), branch);
  const rows = await parse();
  assert.equal(rows.length, 3);
  assert.equal('priceVersion' in rows[0], false);
  assert.equal(rows[1].priceMaintenance, null);
  sheet.getCell('D7').value = 0;
  assert.equal((await parse())[1].priceService, '0');
  for (const value of [null, -1, '1.234', { formula: '1+2', result: 3 }]) {
    sheet.getCell('D7').value = value;
    await assert.rejects(parse, error => error.statusCode === 400);
  }
  sheet.getCell('D7').value = 45;
  sheet.getCell('G7').value = 'invalid';
  await assert.rejects(parse, error => error.statusCode === 400);
  sheet.getCell('G7').value = 2;
  await assert.rejects(() => parsePriceWorkbook(Buffer.from('invalid'), branch), error => error.statusCode === 400);
  await assert.rejects(async () => parsePriceWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), randomUUID()), error => error.statusCode === 403);

  const contract = { id: randomUUID(), companyId: randomUUID(), version: 0, status: 'ACTIVE', isActive: true, effectiveFrom: new Date('2020-01-01'), effectiveUntil: new Date('2099-01-01') };
  let inserted = [], existing = [], sizeUpdates = 0;
  const tx = {
    $executeRaw: async () => 1,
    companyContract: { findFirst: async () => contract, update: async () => ({ ...contract, version: 1 }) },
    itemSize: { findMany: async () => sizes, findFirst: async () => sizes[0], updateMany: async () => {}, update: async () => { sizeUpdates++; } },
    item: { findFirst: async () => sizes[0].item, updateMany: async () => {}, update: async () => ({ ...sizes[0].item, version: 2 }) },
    itemPrice: { findUnique: async () => sizes[0].price, update: async () => ({ ...sizes[0].price, version: 2 }) },
    companyContractPrice: { findMany: async () => existing, createMany: async ({ data }) => { inserted = data; } },
    catalogAuditLog: { createMany: async () => {}, create: async () => {} },
    companyContractHistory: { create: async () => {} },
  };
  prisma.$transaction = async callback => callback(tx);
  const upload = () => repository.importPrices(contract.id, contract.companyId, 0, rows, branch, actor);
  sizes[0].price.version = 100;
  assert.equal((await upload()).imported, 3);
  assert.equal(inserted[1].catalogSnapshot.hasMaintenance, false);
  assert.equal(inserted[1].priceService.toString(), '100.25');
  sizes[0].price = null;
  assert.equal((await upload()).imported, 3);
  sizes[1].version++;
  inserted = [];
  await assert.rejects(upload, error => error.statusCode === 409 && /Size changed/.test(error.errors[0].message));
  assert.equal(inserted.length, 0);
  sizes[1].version--;
  existing = [{ itemSizeId: sizes[0].id }];
  await assert.rejects(upload, error => error.statusCode === 409);
  existing = [];
  rows[0].priceMaintenance = null;
  await assert.rejects(upload, error => error.statusCode === 400);
  rows[0].priceMaintenance = '20';
  await assert.rejects(() => repository.importPrices(contract.id, contract.companyId, 99, rows, branch, actor), error => error.statusCode === 409);

  // A normal price edit must leave ItemSize.version unchanged, including the write path.
  sizes[0].price = { id: randomUUID(), version: 0, isActive: true, priceServicePrimary: '100', priceMaintenancePrimary: '20' };
  await itemWriteRepository.savePrice(sizes[0].id, { version: 0, priceServicePrimary: '110', priceMaintenancePrimary: '20', priceMaintenanceSisterCompany: '10' }, branch, actor);
  assert.equal(sizeUpdates, 0);
  console.log('PASS: Excel round trip, all-row import, service-less pricing, default query order, protected cells, English headers, removed price version, stale size/contract checks, validation, and normal-price version independence.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
