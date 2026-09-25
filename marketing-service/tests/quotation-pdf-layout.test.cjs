const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const PDFDocument = require('pdfkit');
const { renderQuotationPdf } = require('../dist/modules/quotations/quotation-pdf.js');
const { Prisma } = require('@prisma/client');
const D = value => new Prisma.Decimal(value);

async function main() {
  const actor = { id: randomUUID(), name: 'Yola' };
  const base = {
    no: null, numberYear: null, revision: 0, date: new Date('2026-09-29'), inquiryDate: new Date('2026-09-10'),
    inquiryMethod: 'EMAIL', subject: 'Layout test', companySnapshot: { type: 'PT', name: 'Customer', address: 'Jakarta' },
    customerSnapshot: 'Contact', termOfPayment: '30 days', validity: '30 days', location: 'AKURA BALIKPAPAN',
    supplyAkura: 'Tools', supplyCustomer: 'Access', accomplished: '1 (one) Month',
    deliveryReports: '3 (three) working days after job accomplishment', deliveryInvoice: '1 (one) working day',
    jobStart: 'As long team is available', tax: D(11), subTotal: D('1438350000'), taxAmount: D('158218500'), total: D('1596568500'),
  };
  const line = (position, priceSelection, itemName, qty = '2') => ({
    position, isActive: true, serviceName: 'Inspection', serviceType: 'TUBULAR', itemName, size: 'Large',
    priceSelection, quantityInspection: D(qty), priceInspection: D('300000'), quantityMaintenance: D('0'), priceMaintenance: null,
    note: null,
  });
  const capture = async (items, contacts) => {
    const texts = [];
    const original = PDFDocument.prototype.text;
    PDFDocument.prototype.text = function (value, ...args) { texts.push(String(value)); return original.call(this, value, ...args); };
    try {
      const pdf = await renderQuotationPdf({ ...base, items }, actor, new Date('2026-09-29'), true, contacts);
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      return texts;
    } finally { PDFDocument.prototype.text = original; }
  };

  // 1. Service and scope share one row; a group without scopes omits the scope line entirely.
  const withScope = await capture([line(0, { serviceId: 's1', serviceScopes: 'Visual Inspection, Cleaning', inspectionScopes: 'Visual Inspection', maintenanceScopes: 'Cleaning' }, 'Drill Pipe')]);
  // row() renders bold prefixes as separate text calls: prefix then remainder.
  assert(withScope.includes('Type of service:'));
  assert(withScope.some(text => text.includes('TUBULAR - Inspection')));
  assert(withScope.includes('Scope of works:'));
  assert(withScope.some(text => text.includes('Visual Inspection, Cleaning')));
  const noScope = await capture([line(0, { serviceId: 's1', serviceScopes: '', inspectionScopes: '', maintenanceScopes: '' }, 'Drill Pipe')]);
  assert(!noScope.includes('Scope of works:'), 'scope line must be omitted when empty');
  assert(!noScope.some(text => text.includes('Scope of works: -')), 'placeholder scope must not render');
  assert(noScope.includes('Type of service:'));
  assert(noScope.some(text => text.includes('TUBULAR - Inspection')));

  // 2. Job Location block with subtotal, tax and total price on the right.
  const totals = await capture([line(0, { serviceId: 's1', serviceScopes: 'Visual', inspectionScopes: 'Visual', maintenanceScopes: '' }, 'Drill Pipe')]);
  assert(totals.some(text => text.includes('Job Location : AKURA BALIKPAPAN')));
  assert(totals.includes('SUB TOTAL'));
  assert(totals.includes('TAX 11%'));
  assert(totals.includes('TOTAL PRICE'));
  assert(totals.some(text => text.replace(/,/g, '').replace(/\.00$/, '') === '1438350000'), 'subtotal value expected');
  assert(totals.some(text => text.replace(/,/g, '').replace(/\.00$/, '') === '1596568500'), 'total value expected');

  // 3. Footer per reference template: Job Start/Job Accomplishment/Delivery columns,
  //    Prepared By = actor, Approved By = Matthews, and contact list from Marketing admins.
  assert(totals.includes('Job Start'));
  assert(totals.includes('Job Accomplishment*'));
  assert(totals.includes('Delivery Inspection'));
  assert(totals.includes('Delivery Invoice(s)'));
  assert(totals.some(text => text.includes('*') && text.includes('Without additional job')));
  assert(totals.includes('Prepared By'));
  assert(totals.includes('Reviewed and Approved By'));
  assert(totals.includes('Date Submitted'));
  assert(totals.includes('Yola'), 'Prepared By uses actor.name');
  assert(totals.includes('Matthews'), 'Approved By is fixed');
  const contacts = [
    { name: 'Artha', email: 'artha@akurabinacitra.com', telp: '+6281119194233' },
    { name: 'Tika', email: 'mktadm@akurabinacitra.com', telp: '+6281261001050' },
  ];
  const withContacts = await capture([line(0, { serviceId: 's1', serviceScopes: 'Visual', inspectionScopes: 'Visual', maintenanceScopes: '' }, 'Drill Pipe')], contacts);
  assert(withContacts.some(text => text.includes('If you have any question(s)')));
  assert(withContacts.some(text => text.includes('Artha')));
  assert(withContacts.some(text => text.includes('artha@akurabinacitra.com')));
  assert(withContacts.some(text => text.includes('+6281119194233')));

  console.log('PASS: quotation PDF layout - merged service/scope row, omitted empty scope, job location/totals block, template footer and marketing contacts.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });