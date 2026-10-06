const assert = require('node:assert/strict');
const { readdirSync, statSync, existsSync } = require('node:fs');
const path = require('node:path');
const { nodeFileTrace } = require('@vercel/nft');

// Vercel packages each serverless function with @vercel/nft file tracing. pdfkit
// loads its standard font metrics at runtime through the package "imports" wildcard
// ("#standard-fonts/*") via createRequire, which the tracer cannot follow (pdfkit
// issue #1801), so the deployment throws MODULE_NOT_FOUND for
// js/standard-fonts/Helvetica.cjs. Quotation images are also read from computed
// absolute paths. Both must be anchored with literal specifiers so the tracer
// copies them into /var/task.
async function main() {
  const root = path.resolve(__dirname, '..');
  const entry = path.join(root, 'dist', 'server.js');
  assert.ok(existsSync(entry), 'dist/server.js is required (run npm run build first)');

  const { fileList } = await nodeFileTrace([entry], { base: root });
  const traced = new Set([...fileList].map(file => file.split(path.sep).join('/')));
  const isTraced = absolute => traced.has(path.relative(root, absolute).split(path.sep).join('/'));

  // 1. Every pdfkit standard font metric module (including shared chunks) must be traced.
  const fontsDir = path.join(path.dirname(require.resolve('pdfkit')), 'standard-fonts');
  const walk = dir => readdirSync(dir).flatMap(name => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
  const fontModules = walk(fontsDir).filter(file => file.endsWith('.cjs'));
  assert.ok(fontModules.length >= 15, `expected font metric modules under ${fontsDir}, found ${fontModules.length}`);
  const missingFonts = fontModules.filter(file => !isTraced(file)).map(file => path.relative(root, file));
  assert.deepEqual(missingFonts, [], 'pdfkit standard font metric modules missing from the traced bundle');

  // 2. Quotation letterhead and general terms images must be traced as well.
  const assetsDir = path.join(root, 'assets', 'quotation');
  for (const asset of ['letterhead.png', 'general-terms.png']) {
    assert.ok(isTraced(path.join(assetsDir, asset)), `assets/quotation/${asset} missing from the traced bundle`);
  }

  console.log('PASS: serverless file trace includes pdfkit standard fonts and quotation assets.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });