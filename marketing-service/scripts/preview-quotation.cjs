const fs = require('node:fs');
const { Prisma } = require('@prisma/client');
const { renderQuotationPdf } = require('../dist/modules/quotations/quotation-pdf.js');
const { groupQuotationItems } = require('../dist/modules/quotations/quotation-service-groups.js');
const assert = require('node:assert/strict');
const D = value => new Prisma.Decimal(value);
const item = (position, serviceId, serviceName, scopes, name, size, qty, price, maintenanceQty = 0, maintenancePrice = null) => ({
  position, isActive: true, serviceName, serviceType: serviceId === 'tubular' ? 'TUBULAR' : 'OCTG',
  priceSelection: { serviceId, serviceScopes: scopes, inspectionScopes: scopes.split(', ').filter(scope => scope !== 'Cleaning').join(', '), maintenanceScopes: serviceId === 'tubular' ? 'Cleaning' : '' }, itemName: name, size,
  quantityInspection: D(qty), priceInspection: D(price), quantityMaintenance: D(maintenanceQty),
  priceMaintenance: maintenancePrice === null ? null : D(maintenancePrice),
});
const quote = {
  no: 1, numberYear: 2026, revision: 0, date: new Date('2026-09-13'), inquiryDate: new Date('2026-09-12'), inquiryMethod: 'EMAIL',
  subject: 'CONTOH - Inspection & Maintenance Services',
  companySnapshot: { type: 'PT', name: 'Contoh Pelanggan', address: 'Jl. Raya Industri No. 123, Kawasan Industri Nusantara, Kelurahan Sukamaju, Kecamatan Cikarang Selatan, Kabupaten Bekasi, Jawa Barat 17530, Indonesia', staffTitle: 'mrs' }, customerSnapshot: 'Dewi Purchasing',
  termOfPayment: '30 days after invoice receipt', validity: '30 days', location: 'Customer workshop, Jakarta',
  supplyAkura: 'Qualified personnel, inspection equipment and inspection reports.',
  supplyCustomer: 'Access to work area, equipment handling and site facilities.',
  accomplished: '3 working days after confirmation of order.', deliveryReports: '5 working days after job completion.',
  items: [
    item(0, 'tubular', 'Tubular Inspection', 'Visual Inspection, Dimensional Inspection, Magnetic Particle Inspection, Cleaning', 'Drill Pipe', '3 1/2 inch', 5, 250000, 5, 100000),
    item(1, 'octg', 'OCTG Inspection', 'Visual Inspection, Thread Inspection, Wall Thickness Measurement', 'Tubing', '2 7/8 inch', 20, 125000),
    item(2, 'tubular', 'Tubular Inspection', 'Visual Inspection, Dimensional Inspection, Magnetic Particle Inspection, Cleaning', 'Drill Pipe', '5 inch', 5, 250000, 5, 100000),
  ], tax: D(12), subTotal: D(6000000), taxAmount: D(720000), total: D(6720000),
};
async function main() {
  const groups = groupQuotationItems(quote.items);
  assert.deepEqual(groups.map(group => group.items.map(item => item.position)), [[0, 2], [1]]);
  const pdf = await renderQuotationPdf(quote, { id: '00000000-0000-4000-8000-000000000001', name: 'Contoh Approver' }, new Date('2026-09-13'));
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/quotation-template-preview.pdf', pdf);
  console.log(`Generated tmp/quotation-template-preview.pdf (${pdf.length} bytes); grouping verified.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
