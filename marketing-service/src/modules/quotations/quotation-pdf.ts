import PDFDocument from 'pdfkit';
import { Prisma } from '@prisma/client';
import { resolve } from 'node:path';
import { AuditActor } from '../../types/auth.types.js';

type PdfQuotation = Prisma.QuotationGetPayload<{ include: { items: true } }>;
const assets = resolve(__dirname, '../../../assets/quotation');
const dateText = (date: Date) => date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const money = (value: Prisma.Decimal) => value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const months = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

export async function renderQuotationPdf(quote: PdfQuotation, actor: AuditActor, approvedAt: Date): Promise<Buffer> {
  if (quote.no === null || quote.numberYear === null) throw new Error('Quotation must be numbered by approval before PDF generation');
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
    const row = (values: string[], widths: number[], bold = false, shaded = false, repeat?: () => void) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
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
          lines[cell].slice(offset, offset + take).forEach((line, index) => {
            doc.text(line, x + 5, y + 6 + index * 11, { width: widths[cell] - 10, lineBreak: false });
          });
          x += widths[cell];
        }
        y += height; offset += take;
      }
    };
    const paragraph = (text: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      for (const line of wrap(text, width)) {
        if (y + 13 > bottom) newPage();
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(line, left, y, { width, lineBreak: false });
        y += 12;
      }
      y += 8;
    };
    doc.font('Helvetica-Bold').fontSize(15).text('QUOTATION', left, y, { width, align: 'center' }); y += 35;
    const company = quote.companySnapshot as Record<string, unknown>;
    paragraph(`To: ${company.type ?? ''}. ${company.name ?? ''}\n${company.address ?? ''}`);
    if (quote.customerSnapshot) paragraph(`Attn: ${quote.customerSnapshot}`);
    const documentDate = quote.date ?? approvedAt;
    const number = `ABC / Q - ${quote.no}${quote.revision ? ` R${quote.revision}` : ''} / ${months[documentDate.getUTCMonth()]} / ${quote.numberYear}`;
    const thirds = [width * 0.39, width * 0.34, width * 0.27];
    row(['Subject', 'Inquiry Date', 'Inquiry Method'], thirds, true, true);
    row([quote.subject, dateText(quote.inquiryDate), quote.inquiryMethod.replaceAll('_', ' ')], thirds);
    row(['Terms of Payment', 'Quotation No.', 'Validity of Quotation'], thirds, true, true);
    row([quote.termOfPayment, number, quote.validity], thirds); y += 16;
    paragraph('Dear Sir / Madam,');
    paragraph('Thank you for your valuable inquiry. We are pleased to submit our quotation for your consideration as below:');
    const columns = [32, width - 267, 65, 80, 90];
    const lineHeader = () => row(['Item No.', 'Part Description', 'Qty', 'Price Per Unit (IDR)', 'Line Total (IDR)'], columns, true, true);
    lineHeader();
    let lineNo = 0;
    for (const item of quote.items.filter(item => item.isActive)) {
      const charges = [
        { name: 'Inspection', qty: item.quantityInspection, price: item.priceInspection },
        { name: 'Maintenance', qty: item.quantityMaintenance, price: item.priceMaintenance },
      ];
      for (const charge of charges) {
        if (!charge.qty.greaterThan(0)) continue;
        if (charge.price === null) throw new Error('Missing quotation price');
        row([String(++lineNo), `${item.serviceName} (${item.serviceType})\n${item.itemName} - ${item.size}\n${charge.name}`,
          charge.qty.toString(), money(charge.price), money(charge.qty.mul(charge.price).toDecimalPlaces(2))], columns, false, false, lineHeader);
      }
    }
    row([`Job Location: ${quote.location}`], [width]);
    for (const [label, value] of [['SUB TOTAL', quote.subTotal], [`TAX ${quote.tax}%`, quote.taxAmount], ['TOTAL PRICE', quote.total]] as const) {
      row([label, money(value)], [width - 130, 130], true);
    }
    y += 18;
    paragraph('The proposed price(s) applied with the following conditions:');
    row(['Supplied by Akura', 'Supplied by Customer'], [width / 2, width / 2], true, true);
    row([quote.supplyAkura, quote.supplyCustomer], [width / 2, width / 2]); y += 18;
    paragraph('The good(s) or service(s) will be provided after we receive confirmation of order. Please give attention to the estimation of job / report below:');
    row(['Job Accomplishment', 'Delivery Inspection Report(s)'], [width / 2, width / 2], true, true);
    row([quote.accomplished, quote.deliveryReports], [width / 2, width / 2]); y += 18;
    paragraph('Thank you for doing business with us. We look forward to rendering service to your company.');
    row(['Reviewed and Approved By', 'Date Submitted'], [width / 2, width / 2], true, true);
    row([actor.name, dateText(documentDate)], [width / 2, width / 2]); y += 12;
    paragraph('Electronic Copy, no need signature. Save the Earth - go Paperless.');
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
