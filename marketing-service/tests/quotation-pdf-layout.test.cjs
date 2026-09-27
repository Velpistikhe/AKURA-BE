const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const PDFDocument = require('pdfkit');
const { renderQuotationPdf } = require('../dist/modules/quotations/quotation-pdf.js');
const { Prisma } = require('@prisma/client');
const D = value => new Prisma.Decimal(value);
// Styled text entries captured during render: [{ font, text }].
const styled = texts => texts.styled ?? [];

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
  let lastFillAndStroked = 0;
  const capture = async (items, contacts) => {
    const texts = [];
    const styled = [];
    let filledAndStroked = 0;
    let currentFont = null;
    const original = PDFDocument.prototype.text;
    const originalFont = PDFDocument.prototype.font;
    const originalFillAndStroke = PDFDocument.prototype.fillAndStroke;
    PDFDocument.prototype.font = function (name, ...args) { if (name) currentFont = String(name); return originalFont.call(this, name, ...args); };
    PDFDocument.prototype.text = function (value, ...args) { texts.push(String(value)); styled.push({ font: currentFont, text: String(value) }); return original.call(this, value, ...args); };
    // Estimation header cells must fill and stroke in one path; a lone fill() ends the path and drops the border.
    PDFDocument.prototype.fillAndStroke = function (...args) { filledAndStroked += 1; return originalFillAndStroke.apply(this, args); };
    try {
      const pdf = await renderQuotationPdf({ ...base, items }, actor, new Date('2026-09-29'), true, contacts);
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
      lastFillAndStroked = filledAndStroked;
      texts.styled = styled;
      return texts;
    } finally {
      PDFDocument.prototype.text = original;
      PDFDocument.prototype.font = originalFont;
      PDFDocument.prototype.fillAndStroke = originalFillAndStroke;
    }
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
  assert(totals.some(text => text === '1.'), 'item number must include a trailing period');
  assert(totals.includes('SUB TOTAL'));
  assert(totals.includes('TAX 11%'));
  assert(totals.includes('TOTAL PRICE'));
  assert(totals.some(text => text.replace(/,/g, '').replace(/\.00$/, '') === '1438350000'), 'subtotal value expected');
  assert(totals.some(text => text.replace(/,/g, '').replace(/\.00$/, '') === '1596568500'), 'total value expected');

  // 1b. Item header is split over two lines: "Item" then "No.".
  assert(totals.includes('Item'), 'first header line Item expected');
  assert(totals.includes('No.'), 'second header line No. expected');
  assert(!totals.includes('Item No.'), 'header must not be a single line');

  // 1a. Recipient: "To :" label is plain, the company name is bold on its own line beneath it.
  const recipient = styled(totals);
  const toIndex = recipient.findIndex(entry => entry.text === 'To :');
  assert(toIndex >= 0, 'To : label expected');
  const companyEntry = recipient[toIndex + 1];
  assert(companyEntry && companyEntry.text.includes('PT. Customer'), 'company name rendered directly below To :');
  assert(/bold/i.test(companyEntry.font), `company name must be bold, got ${companyEntry.font}`);
  assert(!/bold/i.test(recipient[toIndex].font), 'To : label must stay regular');

  // 3. Footer per reference template: Job Start/Job Accomplishment/Delivery columns,
  //    Prepared By = actor, Approved By = Matthews, and contact list from Marketing admins.
  assert(totals.includes('Job Start'));
  assert(totals.includes('Job Accomplishment*'));
  assert(totals.includes('Delivery Inspection'));
  assert(totals.includes('Delivery Invoice(s)'));
  // Job Start + Job Accomplishment + Delivery Inspection + Delivery Invoice header cells.
  assert(lastFillAndStroked >= 4, 'estimation header cells must render with filled bordered paths');
  assert(totals.some(text => text.includes('*') && text.includes('Without additional job')));
  assert(lastFillAndStroked >= 4, 'estimation header cells must render with filled bordered paths');
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
  // Contact details use separate text segments so spacing around the dash is preserved.
  assert(withContacts.includes('–'));
  assert(withContacts.some(text => text.includes('artha@akurabinacitra.com')));

  console.log('PASS: quotation PDF layout - merged service/scope row, omitted empty scope, job location/totals block, template footer and marketing contacts.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });