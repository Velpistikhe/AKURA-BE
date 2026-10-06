// pdfkit loads standard font metrics lazily at runtime through its package
// "imports" wildcard ("#standard-fonts/*") using createRequire, a pattern the
// Vercel serverless file tracer (@vercel/nft) cannot follow (pdfkit issue #1801),
// which leaves js/standard-fonts/*.cjs out of the deployment bundle and fails
// with MODULE_NOT_FOUND for Helvetica.cjs when a PDF is rendered. Resolving every
// public standard-font subpath with a literal specifier anchors each metrics
// module in the traced bundle so /var/task keeps the exact files pdfkit resolves
// at runtime. Regression covered by tests/quotation-pdf-serverless-trace.test.cjs.
require.resolve('pdfkit/standard-fonts/Courier');
require.resolve('pdfkit/standard-fonts/CourierBold');
require.resolve('pdfkit/standard-fonts/CourierBoldOblique');
require.resolve('pdfkit/standard-fonts/CourierOblique');
require.resolve('pdfkit/standard-fonts/Helvetica');
require.resolve('pdfkit/standard-fonts/HelveticaBold');
require.resolve('pdfkit/standard-fonts/HelveticaBoldOblique');
require.resolve('pdfkit/standard-fonts/HelveticaOblique');
require.resolve('pdfkit/standard-fonts/Symbol');
require.resolve('pdfkit/standard-fonts/TimesBold');
require.resolve('pdfkit/standard-fonts/TimesBoldItalic');
require.resolve('pdfkit/standard-fonts/TimesItalic');
require.resolve('pdfkit/standard-fonts/TimesRoman');
require.resolve('pdfkit/standard-fonts/ZapfDingbats');

export {};