import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';
import { resolve } from 'node:path';
import { AuditActor, MarketingContact } from '../../types/auth.types.js';
import { groupQuotationItems } from './quotation-service-groups.js';
import { quotationNumberYear } from './quotation-number.js';

type PdfQuotation = Prisma.QuotationGetPayload<{ include: { items: true } }>;
const assets = resolve(__dirname, '../../../assets/quotation');
const dateText = (date: Date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const money = (value: Prisma.Decimal) => value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const months = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export async function renderQuotationPdf(quote: PdfQuotation, actor: AuditActor, approvedAt: Date, preview = false, contacts: MarketingContact[] = []): Promise<Buffer> {
  if (!preview && (quote.no === null || quote.numberYear === null)) throw new Error('Quotation must be numbered by approval before PDF generation');
  const doc = new PDFDocument({ size: 'A4', margins: { top: 110, right: 30, bottom: 45, left: 30 }, bufferPages: true,
    info: { Title: `Quotation ${quote.no} R${quote.revision}`, Author: 'PT. AKURA BINA CITRA' } });
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
      doc.font('Helvetica').fontSize(9).fillColor('black');
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
    const row = (values: string[], widths: number[], bold = false, shaded = false, repeat?: () => void, style: { center?: boolean; alignments?: Array<'left' | 'center' | 'right'>; boldPrefixes?: string[] } = {}) => {
      doc.font(bold || style.boldPrefixes?.length ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      const lines = values.map((value, index) => wrap(value, widths[index] - 10));
      const count = Math.max(...lines.map(cell => cell.length));
      let offset = 0;
      if (y + count * 11 + 12 > bottom && count * 11 + 12 <= bottom - 150) { newPage(); repeat?.(); }
      while (offset < count) {
        if (bottom - y < 23) { newPage(); repeat?.(); }
        const take = Math.min(count - offset, Math.floor((bottom - y - 12) / 11));
        const height = take * 11 + 12;
        let x = left;
        for (let cell = 0; cell < values.length; cell++) {
          if (shaded) doc.rect(x, y, widths[cell], height).fill('#eeeeee');
          doc.lineWidth(0.4).strokeColor('#777777').rect(x, y, widths[cell], height).stroke();
          doc.fillColor('black').font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
          const alignment = style.alignments?.[cell] ?? (style.center ? 'center' : 'left');
          const visible = lines[cell].slice(offset, offset + take);
          const textTop = y + 6 + (style.center ? (take - visible.length) * 11 / 2 : 0);
          visible.forEach((line, index) => {
            const textX = alignment === 'center' ? x + (widths[cell] - doc.widthOfString(line)) / 2
              : alignment === 'right' ? x + widths[cell] - 5 - doc.widthOfString(line) : x + 5;
            const textY = textTop + index * 11;
            const prefix = style.boldPrefixes?.find(value => line.startsWith(value));
            if (prefix) {
              doc.font('Helvetica-Bold').text(prefix, textX, textY, { lineBreak: false });
              const prefixWidth = doc.widthOfString(prefix);
              doc.font('Helvetica').text(line.slice(prefix.length), textX + prefixWidth, textY, { lineBreak: false });
            } else doc.text(line, textX, textY, { width: widths[cell] - 10, lineBreak: false });
          });
          x += widths[cell];
        }
        y += height; offset += take;
      }
    };
    const paragraph = (text: string, bold = false, paragraphWidth = width) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      for (const line of wrap(text, paragraphWidth)) {
        if (y + 13 > bottom) newPage();
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(line, left, y, { width: paragraphWidth, lineBreak: false });
        y += 12;
      }
      y += 8;
    };
    doc.font('Helvetica-Bold').fontSize(15).text('QUOTATION', left, y, { width, align: 'center' }); y += 35;
    const company = quote.companySnapshot as Record<string, unknown>;
    paragraph(`To: ${company.type ?? ''}. ${company.name ?? ''}\n${company.address ?? ''}`, false, width / 2);
    const staffTitle = company.staffTitle === 'mr' ? 'Mr.' : company.staffTitle === 'mrs' ? 'Mrs.' : '';
    if (quote.customerSnapshot) paragraph(`Attn: ${[staffTitle, quote.customerSnapshot].filter(Boolean).join(' ')}`, false, width / 2);
    const documentDate = quote.date ?? approvedAt;
    const number = quote.no === null
      ? `ABC / Q - PREVIEW / ${months[documentDate.getUTCMonth()]} / ${quote.numberYear ?? quotationNumberYear(documentDate)}`
      : `ABC / Q - ${quote.no}${quote.revision ? ` R${quote.revision}` : ''} / ${months[documentDate.getUTCMonth()]} / ${quote.numberYear}`;
    const thirds = [width * 0.39, width * 0.34, width * 0.27];
    row(['Subject', 'Inquiry Date', 'Inquiry Method'], thirds, true, true, undefined, { center: true });
    row([quote.subject, dateText(quote.inquiryDate), quote.inquiryMethod.replaceAll('_', ' ')], thirds, false, false, undefined, { center: true });
    row(['Terms of Payment', 'Quotation No.', 'Validity of Quotation'], thirds, true, true, undefined, { center: true });
    row([quote.termOfPayment, number, quote.validity], thirds, false, false, undefined, { center: true }); y += 16;
    paragraph('Dear Sir / Madam,');
    paragraph('Thank you for your valuable inquiry. We are pleased to submit our quotation for your consideration as below:');
    const columns = [32, width - 267, 65, 80, 90];
    const lineHeader = () => row(['Item No.', 'Part Description', 'Qty', 'Price Per Unit\n(IDR)', 'Line Total\n(IDR)'], columns, true, true, undefined, { center: true });
    lineHeader();
    let lineNo = 0;
    for (const group of groupQuotationItems(quote.items)) {
      const serviceLabel = `Type of service: ${group.type.replaceAll('_', ' ')} - ${group.name}`;
      // Service and scope share one cell; omit the scope line when the group has no scopes.
      const groupScopes = [...new Set([group.inspectionScopes, group.maintenanceScopes].filter(Boolean))].join(', ');
      const groupLabel = groupScopes ? `${serviceLabel}\nScope of works: ${groupScopes}` : serviceLabel;
      const groupStyle = { boldPrefixes: ['Type of service:', 'Scope of works:'] };
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
        doc.font('Helvetica').fontSize(9);
        const firstDescription = [charges[0].item.itemName, charges[0].item.size].filter(Boolean).join(' - ');
        const firstHeight = wrap(firstDescription, columns[1] - 10).length * 11 + 12;
        doc.font('Helvetica-Bold');
        if (y + Math.min(firstHeight, 100) > bottom && firstHeight < bottom - 200) { newPage(); repeatGroup(); }
        for (const { item, qty, price } of charges) {
          if (price === null) throw new Error('Missing quotation price');
          row([String(++lineNo), [item.itemName, item.size].filter(Boolean).join(' - '),
            qty.toString(), money(price), money(qty.mul(price).toDecimalPlaces(2))], columns, false, false, repeatGroup, { alignments: ['left', 'left', 'center', 'right', 'right'] });
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
    const totalsWidth = 230;
    const jobRow = 22;
    const blockTop = y;
    const blockHeight = jobRow * totals.length;
    doc.lineWidth(0.4).strokeColor('#777777').rect(left, blockTop, width - totalsWidth, blockHeight).stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('black')
      .text(`Job Location : ${quote.location}`, left + 5, blockTop + (blockHeight - 11) / 2, { width: width - totalsWidth - 10, lineBreak: false });
    totals.forEach(([label, value], index) => {
      const rowTop = blockTop + index * jobRow;
      const labelBold = label === 'TOTAL PRICE';
      doc.lineWidth(0.4).strokeColor('#777777').rect(left + width - totalsWidth, rowTop, totalsWidth / 2, jobRow).stroke();
      doc.rect(left + width - totalsWidth / 2, rowTop, totalsWidth / 2, jobRow).stroke();
      doc.font(labelBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('black')
        .text(label, left + width - totalsWidth + 5, rowTop + (jobRow - 11) / 2, { width: totalsWidth / 2 - 10, align: 'right', lineBreak: false });
      doc.font(labelBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor('black')
        .text(totalsMoney(value), left + width - totalsWidth / 2 + 5, rowTop + (jobRow - 11) / 2, { width: totalsWidth / 2 - 10, align: 'right', lineBreak: false });
    });
    y = blockTop + blockHeight + 18;
    const supplyIntro = 'The proposed price(s) applied with the following conditions:';
    const supplyHeaders = ['Supplied by Akura', 'Supplied by Customer'];
    const supplyValues = [quote.supplyAkura, quote.supplyCustomer];
    const supplyWidths = [width / 2, width / 2];
    doc.font('Helvetica-Bold').fontSize(9);
    const supplyHeaderHeight = Math.max(...supplyHeaders.map(value => wrap(value, width / 2 - 10).length)) * 11 + 12;
    doc.font('Helvetica').fontSize(9);
    const supplyBodyHeight = Math.max(...supplyValues.map(value => wrap(value, width / 2 - 10).length)) * 11 + 12;
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
    doc.font('Helvetica').fontSize(9);
    const estimationHeight = 11 + 24 + 11 + 30;
    if (y + estimationHeight > bottom) newPage();
    doc.font('Helvetica-Bold').fontSize(9);
    const jobStartHeader = 24;
    doc.rect(left, y, estLeft, jobStartHeader).fill('#eeeeee').stroke('#777777');
    doc.fillColor('black').text('Job Start', left + 5, y + (jobStartHeader - 11) / 2, { width: estLeft - 10, align: 'center', lineBreak: false });
    doc.rect(left + estLeft, y, estRight, jobStartHeader).stroke('#777777');
    doc.text(quote.jobStart, left + estLeft + 5, y + (jobStartHeader - 11) / 2, { width: estRight - 10, align: 'center', lineBreak: false });
    y += jobStartHeader;
    doc.rect(left, y, estLeft, 11 + 12).fill('#eeeeee').stroke('#777777');
    doc.fillColor('black').text('Job Accomplishment*', left + 5, y + 6, { width: estLeft - 10, align: 'center', lineBreak: false });
    doc.rect(left + estLeft, y, estRight / 2, 11 + 12).fill('#eeeeee').stroke('#777777');
    doc.fillColor('black').text('Delivery Inspection', left + estLeft + 5, y + 6, { width: estRight / 2 - 10, align: 'center', lineBreak: false });
    doc.rect(left + estLeft + estRight / 2, y, estRight / 2, 11 + 12).fill('#eeeeee').stroke('#777777');
    doc.fillColor('black').text('Delivery Invoice(s)', left + estLeft + estRight / 2 + 5, y + 6, { width: estRight / 2 - 10, align: 'center', lineBreak: false });
    y += 23;
    const estimationValues: string[] = [quote.accomplished, quote.deliveryReports, quote.deliveryInvoice];
    doc.font('Helvetica').fontSize(9).fillColor('black');
    const estimationLines = estimationValues.map((value, index) => wrap(value, (index === 0 ? estLeft : estRight / 2) - 10));
    const estimationRowHeight = Math.max(...estimationLines.map(lines => lines.length)) * 11 + 12;
    doc.rect(left, y, estLeft, estimationRowHeight).stroke('#777777');
    estimationLines[0].forEach((line, i) => doc.text(line, left + 5, y + 6 + i * 11, { width: estLeft - 10, align: 'center', lineBreak: false }));
    doc.rect(left + estLeft, y, estRight / 2, estimationRowHeight).stroke('#777777');
    estimationLines[1].forEach((line, i) => doc.text(line, left + estLeft + 5, y + 6 + i * 11, { width: estRight / 2 - 10, align: 'center', lineBreak: false }));
    doc.rect(left + estLeft + estRight / 2, y, estRight / 2, estimationRowHeight).stroke('#777777');
    estimationLines[2].forEach((line, i) => doc.text(line, left + estLeft + estRight / 2 + 5, y + 6 + i * 11, { width: estRight / 2 - 10, align: 'center', lineBreak: false }));
    y += estimationRowHeight;
    paragraph('*) Without additional job, proper handling, good weather condition, security during in service, etc');
    if (contacts.length) {
      paragraph('If you have any question(s), please do not hesitate to contact us :');
      doc.font('Helvetica').fontSize(9).fillColor('black');
      const longest = Math.max(...contacts.map(contact => doc.widthOfString(contact.name)));
      for (const contact of contacts) {
        const details = [contact.email, contact.telp].filter(Boolean).join('  ');
        if (y + 13 > bottom) newPage();
        doc.font('Helvetica').fontSize(9)
          .text(contact.name, left + 10, y, { width: longest + 10, lineBreak: false });
        doc.text(`– ${details}`, left + 20 + longest, y, { lineBreak: false });
        y += 13;
      }
      y += 6;
    }
    paragraph('Thank you for (opportunities) doing business with you. We look forward to render service to your company.');
    const footerHeaders = ['Prepared By', 'Reviewed and Approved By', 'Date Submitted'];
    const footerValues = [actor.name, 'Matthews', dateText(documentDate)];
    row(footerHeaders, [width / 3, width / 3, width / 3], true, true, undefined, { center: true });
    row(footerValues, [width / 3, width / 3, width / 3], false, false, undefined, { center: true }); y += 12;
    doc.font('Helvetica-BoldOblique').fontSize(9).fillColor('#2e7d32')
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
      doc.font('Helvetica-Oblique').fontSize(9).fillColor('black').text(`Page ${i + 1} of ${pages.count}`, left, 803, { width, align: 'right', lineBreak: false });
      doc.page.margins.bottom = bottomMargin;
    }
    doc.end();
    return await result;
  } catch (error) {
    doc.destroy();
    throw error;
  }
}
