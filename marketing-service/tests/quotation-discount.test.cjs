const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { createQuotationSchema, addQuotationItemSchema } = require('../dist/modules/quotations/quotation.schemas.js');

const header = {
  inquiryMethod: 'EMAIL', inquiryDate: '2026-01-01', jobStart: 'ASAP', subject: 'Discount quotation',
  termOfPayment: '30 days', validity: '30 days', supplyAkura: 'Equipment', supplyCustomer: 'Access',
  location: 'Jakarta', accomplished: '7 days', deliveryReports: 'PDF', deliveryInvoice: 'After report',
  staffId: randomUUID(),
};
const withItem = (item = {}) => ({ ...header, items: [{ itemSizeId: randomUUID(), quantityInspection: '2', ...item }] });

test('Quotation item discount is a percentage between 0 and 100 and defaults to zero', () => {
  assert.equal(createQuotationSchema.parse(withItem({ discount: '99.99' })).items[0].discount, '99.99');
  assert.equal(createQuotationSchema.parse(withItem({ discount: '100' })).items[0].discount, '100');
  assert.equal(createQuotationSchema.parse(withItem()).items[0].discount, '0');
  assert.equal(createQuotationSchema.parse(withItem({ discount: 25 })).items[0].discount, '25');
  for (const discount of ['-1', -1, '-0.01', '100.01', '101', '999', 150, '10.001', '1e3', '', null, true]) {
    assert.equal(createQuotationSchema.safeParse(withItem({ discount })).success, false, String(discount));
  }
  assert.equal(createQuotationSchema.safeParse(withItem({ discount: '5', priceInspection: '100' })).success, false);
});

test('Add quotation item accepts the same discount percentage contract', () => {
  const line = { version: 0, itemSizeId: randomUUID(), quantityInspection: '2' };
  assert.equal(addQuotationItemSchema.parse({ ...line, discount: '7.25' }).discount, '7.25');
  assert.equal(addQuotationItemSchema.parse({ ...line, discount: '100' }).discount, '100');
  assert.equal(addQuotationItemSchema.parse(line).discount, '0');
  assert.equal(addQuotationItemSchema.parse({ ...line, discount: 0.5 }).discount, '0.5');
  for (const discount of ['-0.01', '100.1', '101', 100.5, '0.001', 'abc', null]) {
    assert.equal(addQuotationItemSchema.safeParse({ ...line, discount }).success, false, String(discount));
  }
  assert.equal(addQuotationItemSchema.safeParse({ ...line, discount: '1', priceInspection: '100' }).success, false);
});
