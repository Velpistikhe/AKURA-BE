/**
 * Catalog fixtures for the reliability suite.
 *
 * A quotation needs a company, a company staff, a tax row and a priced item
 * size. These helpers build that chain through the real API where the
 * endpoint exists, so the concurrency tests exercise production code paths.
 */
import { randomUUID } from 'node:crypto';
import { GATEWAY } from './fixtures.js';
import { httpRequest, syntheticName } from './http.js';

export interface CatalogFixture {
  companyId: string;
  staffId: string;
  /** The size used for the first quotation line. */
  itemSizeId: string;
  /** A second priced size, used when a quotation line must be added. */
  itemSizeId2: string;
  /** A third priced size, so two concurrent adds can use distinct sizes. */
  itemSizeId3: string;
}

/** Creates a company through the public marketing API. */
export const createCompany = async (token: string, name = syntheticName('COMPANY')): Promise<string> => {
  const response = await httpRequest(`${GATEWAY}/api/v1/marketing/companies`, {
    method: 'POST',
    token,
    body: { name, type: 'PT', address: 'RelTest address', npwp: '00.000.000.0-000.000', isSisterCompany: false },
  });
  if (response.status !== 201) {
    throw new Error(`createCompany failed: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  }
  return (response.body as { data: { id: string } }).data.id;
};

/** Creates a company staff member (the quotation customer contact). */
export const createCompanyStaff = async (token: string, companyId: string): Promise<string> => {
  const response = await httpRequest(`${GATEWAY}/api/v1/marketing/company-staffs`, {
    method: 'POST',
    token,
    body: { companyId, name: 'Rel Test Staff', title: 'mr', telp: '0000', email: 'staff@reltest.local' },
  });
  if (response.status !== 201) {
    throw new Error(`createCompanyStaff failed: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  }
  return (response.body as { data: { id: string } }).data.id;
};

/**
 * Creates an item with one directly priced size. The size carries the price
 * that the quotation line resolves.
 */
export const createPricedItem = async (token: string): Promise<string> => {
  const response = await httpRequest(`${GATEWAY}/api/v1/marketing/items`, {
    method: 'POST',
    token,
    body: {
      name: syntheticName('ITEM'),
      uom: 'pcs',
      inspectionScopes: [],
      maintenanceScopes: [],
      sizes: [{ size: null, priceServicePrimary: '1000000', priceServiceSisterCompany: '900000' }],
    },
  });
  if (response.status !== 201) {
    throw new Error(`createPricedItem failed: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  }
  const data = (response.body as { data: { id: string; sizes: Array<{ id: string }> } }).data;
  const sizeId = data.sizes?.[0]?.id;
  if (!sizeId) throw new Error('createPricedItem returned no size');
  return sizeId;
};

/**
 * Builds the full chain required to create a quotation:
 * company -> staff -> two priced item sizes.
 */
export const buildCatalogFixture = async (token: string): Promise<CatalogFixture> => {
  const companyId = await createCompany(token);
  const staffId = await createCompanyStaff(token, companyId);
  const itemSizeId = await createPricedItem(token);
  const itemSizeId2 = await createPricedItem(token);
  const itemSizeId3 = await createPricedItem(token);
  return { companyId, staffId, itemSizeId, itemSizeId2, itemSizeId3 };
};

/**
 * Creates a quotation in CREATED state with one active item line.
 */
export const createQuotation = async (
  token: string,
  fixture: CatalogFixture,
): Promise<{ id: string; version: number }> => {
  const today = new Date().toISOString().slice(0, 10);
  const response = await httpRequest(`${GATEWAY}/api/v1/marketing/quotations`, {
    method: 'POST',
    token,
    body: {
      jobStart: 'RelTest job',
      inquiryMethod: 'VERBAL',
      inquiryDate: today,
      subject: 'RelTest subject',
      termOfPayment: '30',
      validity: '30',
      supplyAkura: 'RelTest supply akura',
      supplyCustomer: 'RelTest supply customer',
      location: 'RelTest location',
      accomplished: 'RelTest accomplished',
      deliveryReports: 'RelTest reports',
      deliveryInvoice: 'RelTest invoice',
      companyId: fixture.companyId,
      staffId: fixture.staffId,
      items: [{ itemSizeId: fixture.itemSizeId, quantityInspection: '1', quantityMaintenance: '0', discount: '0' }],
    },
  });
  if (response.status !== 201) {
    throw new Error(`createQuotation failed: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  }
  const data = (response.body as { data: { id: string; version: number } }).data;
  return { id: data.id, version: data.version };
};

/** Moves a quotation from CREATED to SUBMITTED so it can be approved. */
export const submitQuotation = async (token: string, id: string, version: number): Promise<number> => {
  const response = await httpRequest(`${GATEWAY}/api/v1/marketing/quotations/${id}/submit`, {
    method: 'POST',
    token,
    body: { version },
  });
  if (response.status !== 200) {
    throw new Error(`submitQuotation failed: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  }
  return (response.body as { data: { version: number } }).data.version;
};

/** Approves a quotation and returns the allocated number and version. */
export const approveQuotation = async (
  token: string,
  id: string,
  version: number,
): Promise<{ no: number; numberYear: number; version: number }> => {
  const response = await httpRequest(`${GATEWAY}/api/v1/marketing/quotations/${id}/approve`, {
    method: 'POST',
    token,
    body: { version },
  });
  if (response.status !== 200) {
    throw new Error(`approveQuotation failed: HTTP ${response.status} ${JSON.stringify(response.body)}`);
  }
  const data = (response.body as { data: { no: number; numberYear: number; version: number } }).data;
  return data;
};

/** Creates a quotation, submits it and returns it ready for approval. */
export const createSubmittedQuotation = async (
  token: string,
  fixture: CatalogFixture,
): Promise<{ id: string; version: number }> => {
  const quotation = await createQuotation(token, fixture);
  const version = await submitQuotation(token, quotation.id, quotation.version);
  return { id: quotation.id, version };
};

export { randomUUID };
