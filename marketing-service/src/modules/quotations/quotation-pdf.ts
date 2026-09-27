import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { AuditActor, MarketingContact } from '../../types/auth.types.js';
import { groupQuotationItems } from './quotation-service-groups.js';
import { quotationNumberYear } from './quotation-number.js';

type PdfQuotation = Prisma.QuotationGetPayload<{ include: { items: true } }>;
const assets = resolve(__dirname, '../../../assets/quotation');
// Font family matches the reference quotation (Arial); fall back to Helvetica when no Arial-compatible file exists.
const fontCandidates = {
  regular: ['C:\\Windows\\Fonts\\arial.ttf', '/Library/Fonts/Arial.ttf', '/usr/share/fonts/truetype/msttcorefonts/Arial.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf'],
  bold: ['C:\\Windows\\Fonts\\arialbd.ttf', '/Library/Fonts/Arial Bold.ttf', '/usr/share/fonts/truetype/msttcorefonts/Arial_Bold.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'],
  italic: ['C:\\Windows\\Fonts\\ariali.ttf', '/Library/Fonts/Arial Italic.ttf', '/usr/share/fonts/truetype/msttcorefonts/Arial_Italic.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf'],
  boldItalic: ['C:\\Windows\\Fonts\\arialbi.ttf', '/Library/Fonts/Arial Bold Italic.ttf', '/usr/share/fonts/truetype/msttcorefonts/Arial_Bold_Italic.ttf', '/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf'],
} as const;
const fontFiles = {
  regular: fontCandidates.regular.find(candidate => existsSync(candidate)),
  bold: fontCandidates.bold.find(candidate => existsSync(candidate)),
  italic: fontCandidates.italic.find(candidate => existsSync(candidate)),
  boldItalic: fontCandidates.boldItalic.find(candidate => existsSync(candidate)),
};
const arialRegistered = Object.values(fontFiles).every(Boolean);
const fonts = arialRegistered
  ? { regular: 'Arial-regular', bold: 'Arial-bold', italic: 'Arial-italic', boldItalic: 'Arial-boldItalic' } as const
  : { regular: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique', boldItalic: 'Helvetica-BoldOblique' } as const;
// Font sizes follow the reference quotation PDF.
const fontSizes = { title: 16, body: 11, value: 10, table: 10.6, footnote: 10 } as const;
const lineHeight = (size: number) => Math.round(size * 1.15);
const dateText = (date: Date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const money = (value: Prisma.Decimal) => value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const months = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export async function renderQuotationPdf(quote: PdfQuotation, actor: AuditActor, approvedAt: Date, preview = false, contacts: MarketingContact[] = []): Promise<Buffer> {
  if (!preview && (quote.no === null || quote.numberYear === null)) throw new Error('Quotation must be numbered by approval before PDF generation');
  const doc = new PDFDocument({ size: 'A4', margins: { top: 110, right: 30, bottom: 45, left: 30 }, bufferPages: true,
    info: { Title: `Quotation ${quote.no} R${quote.revision}`, Author: 'PT. AKURA BINA CITRA' } });
  if (arialRegistered) {
    doc.registerFont(fonts.regular, fontFiles.regular!);
    doc.registerFont(fonts.bold, fontFiles.bold!);
    doc.registerFont(fonts.italic, fontFiles.italic!);
    doc.registerFont(fonts.boldItalic, fontFiles.boldItalic!);
  }
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolveBuffer, reject) => {
    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => resolveBuffer(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  // Attach a handler immediately in case asset loading fails before the stream ends.
  void result.catch(() => undefined);
  try {
    const left = 30, width = doc.page.width - 60, bottom = 788;
    let y = 108;
    const header = () => {
      doc.image(resolve(assets, 'letterhead.png'), left, 30, { width });
      doc.font(fonts.regular).fontSize(fontSizes.body).fillColor('black');
      y = 108;
    };
    const newPage = () => { doc.addPage(); header(); };
    header();
    const wrap = (text: string, cellWidth: number): string[] => {
      const lines: string[] = [];
      for (const paragraph of text.split(/\r?\n/)) {
        let line = '';
        for (const word of paragraph.split(/\s+/)) {
          const candidate = line ? `${line} ${word}` : word;
          if (doc.widthOfString(candidate) <= cellWidth) { line = candidate; continue; }
          if (line) lines.push(line);
          line = '';
          for (const char of word) {
            if (line && doc.widthOfString(line + char) > cellWidth) { lines.push(line); line = ''; }
            line += char;
          }
        }
        lines.push(line);
      }
      return lines;
    };
    const row = (values: string[], widths: number[], bold = false, shaded = false, repeat?: () => void, style: { center?: boolean; alignments?: Array<'left' | 'center' | 'right'>; boldPrefixes?: string[]; fontSize?: number } = {}) => {
      const fontSize = style.fontSize ?? fontSizes.body;
      const line = lineHeight(fontSize);
      const cellPad = 4;
      doc.font(bold || style.boldPrefixes?.length ? fonts.bold : fonts.regular).fontSize(fontSize);
      const lines = values.map((value, index) => wrap(value, widths[index] - cellPad * 2));
      const count = Math.max(...lines.map(cell => cell.length));
      let offset = 0;
      if (y + count * line + 12 > bottom && count * line + 12 <= bottom - 150) { newPage(); repeat?.(); }
      while (offset < count) {
        if (bottom - y < line + 12) { newPage(); repeat?.(); }
        const take = Math.min(count - offset, Math.floor((bottom - y - 12) / line));
        const height = take * line + 12;
        let x = left;
        for (let cell = 0; cell < values.length; cell++) {
          if (shaded) doc.rect(x, y, widths[cell], height).fill('#eeeeee');
          doc.lineWidth(0.4).strokeColor('#777777').rect(x, y, widths[cell], height).stroke();
          doc.fillColor('black').font(bold ? fonts.bold : fonts.regular).fontSize(fontSize);
          const alignment = style.alignments?.[cell] ?? (style.center ? 'center' : 'left');
          const visible = lines[cell].slice(offset, offset + take);
          const textTop = y + 6 + (style.center ? (take - visible.length) * line / 2 : 0);
          visible.forEach((lineText, index) => {
            const textX = alignment === 'center' ? x + (widths[cell] - doc.widthOfString(lineText)) / 2
              : alignment === 'right' ? x + widths[cell] - 5 - doc.widthOfString(lineText) : x + cellPad;
            const textY = textTop + index * line;
            const prefix = style.boldPrefixes?.find(value => lineText.startsWith(value));
            if (prefix) {
              doc.font(fonts.bold).text(prefix, textX, textY, { lineBreak: false });
              const prefixWidth = doc.widthOfString(prefix);
              doc.font(fonts.regular).text(lineText.slice(prefix.length), textX + prefixWidth, textY, { lineBreak: false });
            } else doc.text(lineText, textX, textY, { width: widths[cell] - cellPad * 2, lineBreak: false });
          });
          x += widths[cell];
        }
        y += height; offset += take;
      }
    };
    const paragraph = (text: string, bold = false, paragraphWidth = width, fontSize: number = fontSizes.body) => {
      const line = lineHeight(fontSize);
      doc.font(bold ? fonts.bold : fonts.regular).fontSize(fontSize);
      for (const wrapped of wrap(text, paragraphWidth)) {
        if (y + line + 2 > bottom) newPage();
        doc.font(bold ? fonts.bold : fonts.regular).fontSize(fontSize).text(wrapped, left, y, { width: paragraphWidth, lineBreak: false });
        y += line;
      }
      y += 8;
    };
    doc.font(fonts.bold).fontSize(fontSizes.title).text('QUOTATION', left, y, { width, align: 'center' }); y += 42;
    const company = quote.companySnapshot as Record<string, unknown>;
    const companyType = String(company.type ?? '').trim();
    const companyName = String(company.name ?? '').trim();
    const companyLabel = [companyType, companyName].filter(Boolean).join('. ');
    const companyAddress = String(company.address ?? '').trim();
    // Keep the recipient label separate; the company name is bold on the next line like the reference PDF.
    doc.font(fonts.regular).fontSize(fontSizes.body).text('To :', left, y, { width: width / 2, lineBreak: false });
    y += lineHeight(fontSizes.body);
    doc.font(fonts.bold).fontSize(fontSizes.body).text(companyLabel, left, y, { width: width / 2, lineBreak: false });
    y += lineHeight(fontSizes.body);
    for (const addressLine of wrap(companyAddress, width / 2)) {
      doc.font(fonts.regular).fontSize(fontSizes.body).text(addressLine, left, y, { width: width / 2, lineBreak: false });
      y += lineHeight(fontSizes.body);
    }
    y += 8;
    const staffTitle = company.staffTitle === 'mr' ? 'Mr.' : company.staffTitle === 'mrs' ? 'Mrs.' : '';
    if (quote.customerSnapshot) paragraph(`Attn: ${[staffTitle, quote.customerSnapshot].filter(Boolean).join(' ')}`, false, width / 2);
    const documentDate = quote.date ?? approvedAt;
    const number = quote.no === null
      ? `ABC / Q - PREVIEW / ${months[documentDate.getUTCMonth()]} / ${quote.numberYear ?? quotationNumberYear(documentDate)}`
      : `ABC / Q - ${quote.no}${quote.revision ? ` R${quote.revision}` : ''} / ${months[documentDate.getUTCMonth()]} / ${quote.numberYear}`;
    const thirds = [width * 0.39, width * 0.34, width * 0.27];
    row(['Subject', 'Inquiry Date', 'Inquiry Method'], thirds, true, true, undefined, { center: true, fontSize: fontSizes.body });
    row([quote.subject, dateText(quote.inquiryDate), quote.inquiryMethod.replaceAll('_', ' ')], thirds, false, false, undefined, { center: true, fontSize: fontSizes.value });
    row(['Terms of Payment', 'Quotation No.', 'Validity of Quotation'], thirds, true, true, undefined, { center: true, fontSize: fontSizes.body });
    row([quote.termOfPayment, number, quote.validity], thirds, false, false, undefined, { center: true, fontSize: fontSizes.value }); y += 16;
    paragraph('Dear Sir / Madam,');
    paragraph('Thank you for your valuable inquiry. We are pleased to submit our quotation for your consideration as below:');
    // Keep the compact reference width; the header is intentionally split into two lines.
    const columns = [32, width - 267, 65, 80, 90];
    const lineHeader = () => row(['Item\nNo.', 'Part Description', 'Qty', 'Price Per Unit\n(IDR)', 'Line Total\n(IDR)'], columns, true, true, undefined, { center: true, fontSize: fontSizes.table });
    lineHeader();
    let lineNo = 0;
    for (const group of groupQuotationItems(quote.items)) {
      const serviceLabel = `Type of service: ${group.type.replaceAll('_', ' ')} - ${group.name}`;
      // Service and scope share one cell; omit the scope line when the group has no scopes.
      const groupScopes = [...new Set([group.inspectionScopes, group.maintenanceScopes].filter(Boolean))].join(', ');
      const groupLabel = groupScopes ? `${serviceLabel}\nScope of works: ${groupScopes}` : serviceLabel;
      const groupStyle = { boldPrefixes: ['Type of service:', 'Scope of works:'], fontSize: fontSizes.table };
      const groupHeader = () => row([groupLabel], [width], false, false, lineHeader, groupStyle);
      groupHeader();
      const repeatGroup = () => { lineHeader(); row([groupLabel], [width], false, false, lineHeader, groupStyle); };
      for (const chargeType of ['Inspection', 'Maintenance'] as const) {
        const charges = group.items.map(item => ({
          item,
          qty: chargeType === 'Inspection' ? item.quantityInspection : item.quantityMaintenance,
          price: chargeType === 'Inspection' ? item.priceInspection : item.priceMaintenance,
        })).filter(charge => charge.qty.greaterThan(0));
        if (!charges.length) continue;
        // Keep the subgroup heading with at least its first item.
        doc.font(fonts.regular).fontSize(fontSizes.table);
        const firstDescription = [charges[0].item.itemName, charges[0].item.size].filter(Boolean).join(' - ');
        const firstHeight = wrap(firstDescription, columns[1] - 12).length * lineHeight(fontSizes.table) + 12;
        doc.font(fonts.bold);
        if (y + Math.min(firstHeight, 100) > bottom && firstHeight < bottom - 200) { newPage(); repeatGroup(); }
        for (const { item, qty, price } of charges) {
          if (price === null) throw new Error('Missing quotation price');
          row([`${++lineNo}.`, [item.itemName, item.size].filter(Boolean).join(' - '),
            qty.toString(), money(price), money(qty.mul(price).toDecimalPlaces(2))], columns, false, false, repeatGroup, { alignments: ['center', 'left', 'center', 'right', 'right'], fontSize: fontSizes.table });
        }
      }
    }
    // Job Location on the left, subtotal block on the right, inside one bordered block (image 2).
    // Totals follow the reference template: group thousands and omit a zero fractional part.
    const totalsMoney = (value: Prisma.Decimal) => {
      const rounded = value.toDecimalPlaces(2);
      return rounded.equals(rounded.toFixed(0))
        ? rounded.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
        : money(value);
    };
    const totals: Array<[string, Prisma.Decimal]> = [
      ['SUB TOTAL', quote.subTotal], [`TAX ${quote.tax}%`, quote.taxAmount], ['TOTAL PRICE', quote.total],
    ];
    // Totals share the item table geometry: Job Location spans Item No. + Part Description,
    // labels span Qty + Price columns, and numbers sit in the Line Total column.
    const totalsWidth = columns[2] + columns[3] + columns[4];
    const totalsLabelWidth = columns[2] + columns[3];
    const totalsValueWidth = columns[4];
    const jobRow = 24;
    const blockTop = y;
    const blockHeight = jobRow * totals.length;
    doc.lineWidth(0.4).strokeColor('#777777').rect(left, blockTop, width - totalsWidth, blockHeight).stroke();
    doc.font(fonts.bold).fontSize(fontSizes.table).fillColor('black')
      .text(`Job Location : ${quote.location}`, left + 5, blockTop + (blockHeight - lineHeight(fontSizes.table)) / 2, { width: width - totalsWidth - 10, lineBreak: false });
    totals.forEach(([label, value], index) => {
      const rowTop = blockTop + index * jobRow;
      const labelBold = label === 'TOTAL PRICE';
      const labelX = left + width - totalsWidth;
      const valueX = labelX + totalsLabelWidth;
      doc.lineWidth(0.4).strokeColor('#777777').rect(labelX, rowTop, totalsLabelWidth, jobRow).stroke();
      doc.rect(valueX, rowTop, totalsValueWidth, jobRow).stroke();
      doc.font(labelBold ? fonts.bold : fonts.regular).fontSize(fontSizes.table).fillColor('black')
        .text(label, labelX + 5, rowTop + (jobRow - lineHeight(fontSizes.table)) / 2, { width: totalsLabelWidth - 10, align: 'right', lineBreak: false });
      doc.font(labelBold ? fonts.bold : fonts.regular).fontSize(fontSizes.table).fillColor('black')
        .text(totalsMoney(value), valueX + 5, rowTop + (jobRow - lineHeight(fontSizes.table)) / 2, { width: totalsValueWidth - 10, align: 'right', lineBreak: false });
    });
    y = blockTop + blockHeight + 18;
    const supplyIntro = 'The proposed price(s) applied with the following conditions:';
    const supplyHeaders = ['Supplied by Akura', 'Supplied by Customer'];
    const supplyValues = [quote.supplyAkura, quote.supplyCustomer];
    const supplyWidths = [width / 2, width / 2];
    doc.font(fonts.bold).fontSize(fontSizes.body);
    const supplyHeaderHeight = Math.max(...supplyHeaders.map(value => wrap(value, width / 2 - 12).length)) * lineHeight(fontSizes.body) + 12;
    doc.font(fonts.regular).fontSize(fontSizes.body);
    const supplyBodyHeight = Math.max(...supplyValues.map(value => wrap(value, width / 2 - 12).length)) * lineHeight(fontSizes.body) + 12;
    const supplyBlockHeight = wrap(supplyIntro, width).length * 12 + 8 + supplyHeaderHeight + supplyBodyHeight;
    // Keep the introduction, header and both supply cells together on one page.
    if (y + supplyBlockHeight > bottom) newPage();
    paragraph(supplyIntro);
    const supplyHeader = () => row(supplyHeaders, supplyWidths, true, true);
    supplyHeader();
    row(supplyValues, supplyWidths, false, false, supplyHeader); y += 18;
    // Estimation block per reference template (image 4): Job Start spans two columns above
    // Job Accomplishment / Delivery Inspection / Delivery Invoice.
    paragraph('The good(s) or service(s) will be provided after we receive confirmation of order. Please give attention with the estimation of job / report below :');
    const estLeft = width * 0.31, estRight = width - estLeft;
    // Page break for the whole estimation block when it cannot fit.
    doc.font(fonts.regular).fontSize(fontSizes.value);
    const estimationValueLine = lineHeight(fontSizes.value);
    // Header cells are two text lines tall; value row height follows wrapped lines.
    const jobStartHeader = lineHeight(fontSizes.body) + 16;
    const estimationHeader = lineHeight(fontSizes.body) + 12;
    const estimationValueLines = [quote.accomplished, quote.deliveryReports, quote.deliveryInvoice]
      .map((value, index) => wrap(value, (index === 0 ? estLeft : estRight / 2) - 12));
    const estimationValueRow = Math.max(...estimationValueLines.map(lines => lines.length)) * estimationValueLine + 12;
    const estimationHeight = jobStartHeader + estimationHeader + estimationValueRow;
    if (y + estimationHeight > bottom) newPage();
    doc.font(fonts.bold).fontSize(fontSizes.body);
    // fill() ends the path, so stroke() on the same path would draw nothing; fillAndStroke keeps the border.
    doc.lineWidth(0.4).strokeColor('#777777');
    doc.rect(left, y, estLeft, jobStartHeader).fillAndStroke('#eeeeee', '#777777');
    doc.fillColor('black').text('Job Start', left + 6, y + (jobStartHeader - lineHeight(fontSizes.body)) / 2, { width: estLeft - 12, align: 'center', lineBreak: false });
    doc.rect(left + estLeft, y, estRight, jobStartHeader).stroke('#777777');
    doc.text(quote.jobStart, left + estLeft + 6, y + (jobStartHeader - lineHeight(fontSizes.body)) / 2, { width: estRight - 12, align: 'center', lineBreak: false });
    y += jobStartHeader;
    doc.rect(left, y, estLeft, estimationHeader).fillAndStroke('#eeeeee', '#777777');
    doc.fillColor('black').text('Job Accomplishment*', left + 6, y + (estimationHeader - lineHeight(fontSizes.body)) / 2, { width: estLeft - 12, align: 'center', lineBreak: false });
    doc.rect(left + estLeft, y, estRight / 2, estimationHeader).fillAndStroke('#eeeeee', '#777777');
    doc.fillColor('black').text('Delivery Inspection', left + estLeft + 6, y + (estimationHeader - lineHeight(fontSizes.body)) / 2, { width: estRight / 2 - 12, align: 'center', lineBreak: false });
    doc.rect(left + estLeft + estRight / 2, y, estRight / 2, estimationHeader).fillAndStroke('#eeeeee', '#777777');
    doc.fillColor('black').text('Delivery Invoice(s)', left + estLeft + estRight / 2 + 6, y + (estimationHeader - lineHeight(fontSizes.body)) / 2, { width: estRight / 2 - 12, align: 'center', lineBreak: false });
    y += estimationHeader;
    doc.font(fonts.regular).fontSize(fontSizes.value).fillColor('black');
    estimationValueLines[0].forEach((line, i) => doc.text(line, left + 6, y + 6 + i * estimationValueLine, { width: estLeft - 12, align: 'center', lineBreak: false }));
    doc.rect(left, y, estLeft, estimationValueRow).stroke('#777777');
    estimationValueLines[1].forEach((line, i) => doc.text(line, left + estLeft + 6, y + 6 + i * estimationValueLine, { width: estRight / 2 - 12, align: 'center', lineBreak: false }));
    doc.rect(left + estLeft, y, estRight / 2, estimationValueRow).stroke('#777777');
    estimationValueLines[2].forEach((line, i) => doc.text(line, left + estLeft + estRight / 2 + 6, y + 6 + i * estimationValueLine, { width: estRight / 2 - 12, align: 'center', lineBreak: false }));
    doc.rect(left + estLeft + estRight / 2, y, estRight / 2, estimationValueRow).stroke('#777777');
    y += estimationValueRow;
    // Small gap so the footnote does not touch the table's bottom border.
    y += 6;
    paragraph('*) Without additional job, proper handling, good weather condition, security during in service, etc', false, width, fontSizes.footnote);
    if (contacts.length) {
      // Keep the contact block visually separated from the footnote above and the closing paragraph below.
      y += 8;
      paragraph('If you have any question(s), please do not hesitate to contact us :');
      doc.font(fonts.regular).fontSize(fontSizes.body).fillColor('black');
      const longest = Math.max(...contacts.map(contact => doc.widthOfString(contact.name)));
      for (const contact of contacts) {
        const details = [contact.email, contact.telp].filter(Boolean).join('  ');
        if (y + lineHeight(fontSizes.body) + 2 > bottom) newPage();
        doc.font(fonts.regular).fontSize(fontSizes.body)
          .text(contact.name, left + 10, y, { width: longest + 10, lineBreak: false });
        // Deliberate gap after the name and after the dash for clearer contact details.
        const dashX = left + 20 + longest + 8;
        doc.text('–', dashX, y, { lineBreak: false });
        doc.text(details, dashX + 14, y, { lineBreak: false });
        y += lineHeight(fontSizes.body) + 5;
      }
      y += 10;
    }
    paragraph('Thank you for (opportunities) doing business with you. We look forward to render service to your company.');
    const footerHeaders = ['Prepared By', 'Reviewed and Approved By', 'Date Submitted'];
    const footerValues = [actor.name, 'Matthews', dateText(documentDate)];
    row(footerHeaders, [width / 3, width / 3, width / 3], true, true, undefined, { center: true });
    row(footerValues, [width / 3, width / 3, width / 3], false, false, undefined, { center: true }); y += 12;
    doc.font(fonts.boldItalic).fontSize(fontSizes.body).fillColor('#2e7d32')
      .text('Electronic Copy, no need signature. Save the Earth - go Paperless.', left, y, { width, align: 'center' });
    y += 14;
    newPage();
    // Preserve the supplied template's general terms verbatim, without customer-specific data.
    doc.image(resolve(assets, 'general-terms.png'), left, y, { fit: [width, bottom - y], align: 'center' });
    const pages = doc.bufferedPageRange();
    for (let i = 0; i < pages.count; i++) {
      doc.switchToPage(i);
      const bottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.font(fonts.italic).fontSize(fontSizes.body).fillColor('black').text(`Page ${i + 1} of ${pages.count}`, left, 803, { width, align: 'right', lineBreak: false });
      doc.page.margins.bottom = bottomMargin;
    }
    doc.end();
    return await result;
  } catch (error) {
    doc.destroy();
    throw error;
  }
}
