const assert = require('node:assert/strict');
const { loadQuotationContacts } = require('../dist/modules/quotations/quotation.controller.js');

async function main() {
  const branch = '00000000-0000-4000-8000-00000000000b';
  const localContact = { name: 'Local Admin', email: 'local@akura.test', telp: null };

  // 1. Local read model wins when it has rows; Auth is never called.
  let fetchCalled = 0;
  const ok = await loadQuotationContacts({
    branch, accessToken: 'token',
    loadLocal: async () => [localContact],
    fetchImpl: async () => { fetchCalled += 1; throw new Error('must not be called'); },
  });
  assert.deepEqual(ok, [localContact]);
  assert.equal(fetchCalled, 0, 'local contacts must short-circuit Auth fallback');

  // 2. Empty local read model falls back to Auth with the caller's bearer token.
  const fallback = [];
  const seen = {};
  const returned = await loadQuotationContacts({
    branch, accessToken: 'user-token',
    loadLocal: async () => fallback,
    fetchImpl: async (url, options) => {
      seen.url = url; seen.options = options;
      return { ok: true, json: async () => ({ data: { contacts: [
        { name: 'Artha', email: 'artha@akurabinacitra.com', telp: '+6281119194233' },
        { name: '  Tika  ', email: null, telp: '+6281261001050' },
        { name: '', email: 'ignored@akura.test', telp: null }, // blank names are dropped
        null, 'not-an-object',
      ] } }) };
    },
  });
  assert.equal(seen.url.endsWith('/api/v1/auth/users/marketing-contacts'), true, `unexpected url ${seen.url}`);
  assert.equal(seen.options.headers.authorization, 'Bearer user-token');
  assert.equal(seen.options.method, 'GET');
  assert.deepEqual(returned, [
    { name: 'Artha', email: 'artha@akurabinacitra.com', telp: '+6281119194233' },
    { name: 'Tika', email: null, telp: '+6281261001050' },
  ]);

  // 3. Without a token, or when Auth fails, the local result is returned unchanged.
  assert.deepEqual(await loadQuotationContacts({ branch, loadLocal: async () => fallback, fetchImpl: async () => { throw new Error('must not be called'); } }), fallback);
  assert.deepEqual(await loadQuotationContacts({
    branch, accessToken: 'user-token', loadLocal: async () => fallback,
    fetchImpl: async () => { throw new Error('Auth unavailable'); },
  }), fallback);

  console.log('PASS: quotation contacts loader - local-first, Auth fallback with bearer token, and safe degradation.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });