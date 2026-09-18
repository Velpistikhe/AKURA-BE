const modules = [
  ['Gateway', 'Gateway diagnostics and API documentation.'],
  ['Authentication', 'Login, registration, sessions, and signing keys.'],
  ['Profile', 'Current user profile and password.'],
  ['User Management', 'User administration.'],
  ['Menus', 'Application menus.'],
  ['Menu Items', 'Entries within application menus.'],
  ['Menu Access', 'Role and section access to menus.'],
  ['Office Branches', 'Office branch reference data.'],
  ['Companies', 'Company profiles and history.'],
  ['Company Staff', 'Company contacts and staff history.'],
  ['Services', 'Service catalog and history.'],
  ['Inspection Scopes', 'Inspection scopes belonging to services.'],
  ['Maintenance Scopes', 'Maintenance scopes belonging to services.'],
  ['Items', 'Item references and history.'],
  ['Item Sizes', 'Size references, history, and Excel export.'],
  ['Item Prices', 'Standard prices and price history.'],
  ['Company Contracts', 'Contracts, approval, revision, and termination.'],
  ['Company Contract Prices', 'Contract prices, history, and Excel import.'],
  ['Quotation Options', 'Company-specific size options and resolved prices.'],
  ['Proforma Invoices', 'Proforma invoices linked to quotations.'],
  ['Invoices', 'Invoices linked to quotations.'],
  ['Taxes', 'Finance master tax and cache delivery status.'],
  ['Work Order', 'Field service work orders, inspectors, and change history.'],
  ['Quotations', 'Quotation documents and item lists.'],
] as const;

const moduleFor = (path: string): typeof modules[number][0] => {
  if (path.startsWith('/api/v1/finance/taxes') || path === '/api/v1/marketing/internal/taxes/events') return 'Taxes';
  if (path.endsWith('/health') || !path.startsWith('/api/v1/')) return 'Gateway';
  if (path.startsWith('/api/v1/auth/users')) return 'User Management';
  if (/\/auth\/(me|profile|password)$/.test(path)) return 'Profile';
  if (path.startsWith('/api/v1/auth/')) return 'Authentication';
  if (path.includes('/menu-accesses')) return 'Menu Access';
  if (path.includes('/menu-items')) return 'Menu Items';
  if (path.includes('/menus')) return 'Menus';
  if (path.includes('/office-branches')) return 'Office Branches';
  if (path.includes('/company-staffs') || path.endsWith('/staff-history')) return 'Company Staff';
  if (path.includes('/company-contract-prices') || path.includes('/contract-prices') || path.endsWith('/prices/import')) return 'Company Contract Prices';
  if (path.includes('/contract-references') || path.includes('/company-contract-references')) return 'Company Contracts';
  if (path.includes('/company-contracts')) return 'Company Contracts';
  if (path.includes('/companies')) return 'Companies';
  if (path.includes('/inspection/scopes')) return 'Inspection Scopes';
  if (path.includes('/maintenance/scopes')) return 'Maintenance Scopes';
  if (path.includes('/services')) return 'Services';
  if (path.endsWith('/items/sizes/prices')) return 'Quotation Options';
  if (/\/items\/sizes\/[^/]+\/price(?:\/history)?$/.test(path)) return 'Item Prices';
  if (path.includes('/items/sizes')) return 'Item Sizes';
  if (path.includes('/items')) return 'Items';
  if (path.includes('/proforma-invoices')) return 'Proforma Invoices';
  if (path.startsWith('/api/v1/finance/invoices')) return 'Invoices';
  if (path.startsWith('/api/v1/fieldservice/work-orders')) return 'Work Order';
  if (path.includes('/quotation-references')) return 'Quotations';
  if (path.includes('/quotations')) return 'Quotations';
  throw new Error(`Assign a Swagger module for ${path}`);
};

// Apply tags after composing all path files so nested price/history endpoints
// appear exactly once under their owning module.
export const groupByModule = <T extends { tags: object[]; paths: object }>(document: T): T => ({
  ...document,
  tags: modules.map(([name, description]) => ({ name, description })),
  paths: Object.fromEntries(Object.entries(document.paths).map(([path, pathItem]) => [
    path,
    Object.fromEntries(Object.entries(pathItem).map(([method, operation]) => [
      method,
      /^(get|post|put|patch|delete|options|head|trace)$/.test(method)
        ? { ...(operation as object), tags: [moduleFor(path)] }
        : operation,
    ])),
  ])) as T['paths'],
});
