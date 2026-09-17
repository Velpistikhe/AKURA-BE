import ExcelJS from 'exceljs';
import yauzl from 'yauzl';
import { z } from 'zod';
import { createContractPriceSchema } from '../items/item.schemas.js';
import { contractExcelRepository } from './contract-excel.repository.js';
import { ExcelImportError, ExcelPriceRow, MAX_EXCEL_ROWS } from './contract-excel.schemas.js';

const SHEET = 'Harga Normal';
const HEADERS = ['Pilih', 'Service', 'Item', 'Size', 'Harga Service', 'Harga Maintenance', 'Item Size ID', 'Size Version', 'Price Version'];
const MARKER = 'AKURA_NORMAL_PRICES_V1';
const HEADER_ROW = 5;
const ink = '17365D', yellow = 'FFF2CC', pale = 'EAF0F7';
const numericCell = (value: { toString(): string } | null | undefined): string | number | null => {
  if (value == null) return null;
  const text = value.toString();
  // Excel only preserves 15 significant digits. Keep larger amounts as text.
  return text.replace(/[.\-]/g, '').length <= 15 ? Number(text) : text;
};

export async function createPriceWorkbook(sizes: Awaited<ReturnType<typeof contractExcelRepository.exportSizes>>, branch: string) {
  const now = new Date();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Akura Marketing'; workbook.created = now;
  const sheet = workbook.addWorksheet(SHEET, { views: [{ state: 'frozen', ySplit: HEADER_ROW }], properties: { defaultRowHeight: 23 }, pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 } });
  sheet.columns = [{ width: 12 }, { width: 28 }, { width: 32 }, { width: 22 }, { width: 22 }, { width: 24 }, { width: 38, hidden: true }, { width: 15, hidden: true }, { width: 15, hidden: true }];
  sheet.mergeCells('A1:F1'); sheet.getCell('A1').value = 'AKURA | DAFTAR HARGA NORMAL';
  sheet.getCell('A1').font = { name: 'Calibri', size: 19, bold: true, color: { argb: 'FFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ink } }; sheet.getRow(1).height = 40;
  sheet.mergeCells('A2:F2'); sheet.getCell('A2').value = 'Harga normal primary · Ubah kolom harga untuk membuat harga kontrak';
  sheet.mergeCells('A3:F3'); sheet.getCell('A3').value = 'Pilih YA untuk impor, TIDAK untuk lewati. Kolom kuning dapat diedit. Baca sheet Petunjuk.';
  sheet.getRow(2).height = 26; sheet.getRow(3).height = 26;
  HEADERS.forEach((header, index) => { const cell = sheet.getRow(HEADER_ROW).getCell(index + 1); cell.value = header; cell.font = { bold: true, color: { argb: 'FFFFFF' }, name: 'Calibri' }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ink } }; cell.alignment = { vertical: 'middle', wrapText: true }; });
  sheet.getRow(HEADER_ROW).height = 30;
  sizes.forEach((size, index) => {
    const current = size.price?.isActive && size.price.effectiveFrom <= now && (size.price.effectiveUntil === null || size.price.effectiveUntil > now);
    const servicePrice = current ? numericCell(size.price?.priceServicePrimary) : null;
    const maintenance = current ? numericCell(size.price?.priceMaintenancePrimary) : null;
    const row = sheet.addRow([servicePrice === null || (size.item.service.hasMaintenance && maintenance === null) ? 'TIDAK' : 'YA', size.item.service.name, size.item.name, size.size, servicePrice, maintenance, size.id, size.version, size.price?.version ?? 'NONE']);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      cell.font = { name: 'Calibri', size: 11, color: { argb: ink } };
      cell.alignment = { vertical: 'middle', horizontal: col === 5 || col === 6 ? 'right' : 'left' };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: [1, 5, 6].includes(col) ? yellow : index % 2 ? pale : 'FFFFFF' } };
    });
    row.getCell(1).dataValidation = { type: 'list', allowBlank: false, formulae: ['"YA,TIDAK"'], showErrorMessage: true, errorTitle: 'Pilihan tidak valid', error: 'Pilih YA atau TIDAK.' };
    for (const col of [5, 6]) {
      row.getCell(col).numFmt = '#,##0.00;[Red](#,##0.00);0.00';
      row.getCell(col).dataValidation = { type: 'decimal', operator: 'greaterThanOrEqual', formulae: [0], allowBlank: col === 6 && !size.item.service.hasMaintenance, showErrorMessage: true, errorTitle: 'Harga tidak valid', error: 'Isi harga minimal 0, maksimal 2 desimal. Jangan gunakan formula.' };
    }
    row.getCell(6).note = size.item.service.hasMaintenance ? 'Harga maintenance wajib untuk service ini.' : 'Boleh kosong jika tidak ada harga maintenance.';
  });
  sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: Math.max(HEADER_ROW, sheet.rowCount), column: 6 } };
  sheet.pageSetup.printTitlesRow = '1:5'; sheet.pageSetup.printArea = `A1:F${sheet.rowCount}`;
  const help = workbook.addWorksheet('Petunjuk'); help.columns = [{ width: 7 }, { width: 105 }];
  help.mergeCells('A1:B1'); help.getCell('A1').value = 'PETUNJUK TEMPLATE HARGA KONTRAK'; help.getCell('A1').font = { bold: true, size: 16, color: { argb: ink } }; help.getRow(1).height = 34;
  [
    'Size kosong berarti item tanpa ukuran. Harga tetap dapat diisi dan diimpor menggunakan baris tersebut.',
    'File ini hanya memuat harga normal primary. Tidak memuat harga sister company atau harga kontrak lama.',
    'Edit Harga Service dan Harga Maintenance pada sheet Harga Normal. Nilai yang diisi akan menjadi harga kontrak.',
    'Pilih YA untuk baris yang akan disimpan, TIDAK untuk dilewati. Semua baris YA diimpor, termasuk harga yang tidak diubah.',
    'Harga service wajib. Harga maintenance wajib jika service memiliki maintenance. Nol diperbolehkan; nilai negatif dan lebih dari dua desimal ditolak.',
    'Gunakan nilai angka, bukan formula. Jika menghitung dengan formula, salin lalu Paste Special > Values sebelum upload. Gunakan teks desimal bertitik untuk nominal besar.',
    'Jangan mengubah nama sheet, header, kolom ID/versi tersembunyi atau sheet _Template. Nama service/item/size hanya referensi.',
    'Pilih company dan kontraknya saat upload. Status harus CREATE/ACTIVE, kontrak tidak dinonaktifkan dan belum berakhir; kontrak yang belum mulai dapat diisi.',
    'Impor hanya menambahkan harga baru. Baris yang sudah memiliki harga dalam kontrak akan ditolak. Harga normal tidak berubah.',
    'Jika ada kesalahan, seluruh impor dibatalkan. Respons menyebut nomor baris dan kesalahan untuk diperbaiki.',
    'Jika data berubah sejak unduhan atau versi kontrak sudah berubah, unduh ulang template dan gunakan versi kontrak terbaru.',
    `Maksimal ${MAX_EXCEL_ROWS} baris per file. Gunakan filter saat download untuk membatasi daftar. File kosong tidak dapat diimpor.`,
  ].forEach((line, index) => { const row = help.addRow([index + 1, line]); row.height = 42; row.getCell(2).alignment = { wrapText: true, vertical: 'middle' }; row.font = { name: 'Calibri', size: 11 }; if (index % 2 === 0) row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: pale } }; });
  const meta = workbook.addWorksheet('_Template', { state: 'veryHidden' });
  meta.addRows([['Format', MARKER], ['Branch', branch], ['ExportedAt', now.toISOString()]]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// Bound actual decompression before ExcelJS loads XML/shared strings into memory.
async function validateArchive(buffer: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) { reject(new ExcelImportError([{ message: 'File is not a valid .xlsx workbook' }])); return; }
      let total = 0, entries = 0, finished = false;
      const names = new Set<string>();
      const fail = () => { if (!finished) { finished = true; zip.close(); reject(new ExcelImportError([{ message: 'Workbook is invalid, encrypted or exceeds the decompressed size limit' }])); } };
      zip.on('error', fail);
      zip.on('end', () => { if (!finished) { finished = true; zip.close(); resolve(); } });
      zip.on('entry', entry => {
        if (++entries > 200 || entry.uncompressedSize > 32 * 1024 * 1024 || entry.isEncrypted() || names.has(entry.fileName)) { fail(); return; }
        names.add(entry.fileName);
        if (entry.fileName.endsWith('/')) { zip.readEntry(); return; }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { fail(); return; }
          stream.on('error', fail);
          stream.on('data', (chunk: Buffer) => { total += chunk.length; if (total > 32 * 1024 * 1024) { stream.destroy(); fail(); } });
          stream.on('end', () => { if (!finished) zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}

export async function parsePriceWorkbook(buffer: Buffer, branch: string): Promise<ExcelPriceRow[]> {
  await validateArchive(buffer);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]); }
  catch { throw new ExcelImportError([{ message: 'Cannot read workbook; upload an unencrypted .xlsx template' }]); }
  const meta = workbook.getWorksheet('_Template'), sheet = workbook.getWorksheet(SHEET);
  if (!sheet || meta?.getCell('B1').value !== MARKER) throw new ExcelImportError([{ message: 'Invalid template format; download the current template' }]);
  if (meta.getCell('B2').value !== branch) throw new ExcelImportError([{ message: 'Template belongs to a different branch' }], 403);
  if (HEADERS.some((header, index) => sheet.getRow(HEADER_ROW).getCell(index + 1).value !== header)) throw new ExcelImportError([{ row: HEADER_ROW, message: 'Template headers were changed' }]);
  if (sheet.rowCount > MAX_EXCEL_ROWS + HEADER_ROW) throw new ExcelImportError([{ message: `Maximum ${MAX_EXCEL_ROWS} rows per workbook` }]);
  const rows: ExcelPriceRow[] = [], seen = new Set<string>(), errors: ExcelImportError['errors'] = [];
  for (let number = HEADER_ROW + 1; number <= sheet.rowCount; number++) {
    const row = sheet.getRow(number);
    if (!row.hasValues) continue;
    const include = row.getCell(1).value;
    if (include === 'TIDAK') continue;
    if (include !== 'YA') { errors.push({ row: number, field: 'Pilih', message: 'Choose YA or TIDAK' }); continue; }
    const id = z.string().uuid().safeParse(row.getCell(7).value);
    const sizeVersion = z.number().int().nonnegative().safeParse(row.getCell(8).value);
    const priceVersion = z.union([z.number().int().nonnegative(), z.literal('NONE')]).safeParse(row.getCell(9).value);
    if (!id.success || !sizeVersion.success || !priceVersion.success) { errors.push({ row: number, message: 'Size ID or version metadata was changed; download a new template' }); continue; }
    if (seen.has(id.data)) { errors.push({ row: number, message: 'Duplicate item size in the workbook' }); continue; }
    seen.add(id.data);
    const data = createContractPriceSchema.omit({ contractId: true }).safeParse({ priceService: row.getCell(5).value, priceMaintenance: row.getCell(6).value ?? null });
    if (!data.success) {
      for (const issue of data.error.issues) errors.push({ row: number, field: issue.path[0] === 'priceService' ? 'Harga Service' : 'Harga Maintenance', message: 'Enter a nonnegative value with at most two decimals; service price is required and formulas are not accepted' });
      continue;
    }
    rows.push({ row: number, itemSizeId: id.data, sizeVersion: sizeVersion.data, priceVersion: priceVersion.data === 'NONE' ? null : priceVersion.data,
      priceService: String(data.data.priceService), priceMaintenance: data.data.priceMaintenance == null ? null : String(data.data.priceMaintenance),
    });
  }
  if (errors.length) throw new ExcelImportError(errors);
  if (!rows.length) throw new ExcelImportError([{ message: 'Select at least one row with YA' }]);
  return rows;
}
