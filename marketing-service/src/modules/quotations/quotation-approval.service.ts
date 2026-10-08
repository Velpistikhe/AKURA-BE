import { createHash, randomUUID } from 'node:crypto';
import { quotationRepository, approvableStatuses } from './quotation.repository.js';
import { processDueQuotationDeliveries, wakeQuotationDelivery } from './quotation-sync.repository.js';
import { approveQuotationSchema } from './quotation.schemas.js';
import { renderQuotationPdf } from './quotation-pdf.js';
import { quotationStorage } from './quotation-storage.js';
import { AuditActor, MarketingContact } from '../../types/auth.types.js';
import { HttpError } from '../../utils/httpError.js';
import { logger } from '../../utils/logger.js';

export interface QuotationPdfMetadata {
  bucket: string; key: string; fileName: string; contentType: string; size: number; sha256: string;
  revision: number; version: number; approvedAt: string; approvedById: string; approvedByName: string;
}

export const quotationApproval = {
  async get(id: string, officeBranchId: string) {
    const quote = await quotationRepository.find(id, officeBranchId);
    return quote.pdfDocument ? { ...quote, pdf: { ...quote.pdfDocument,
      ...await quotationStorage.downloadUrl(quote.pdfDocument.bucket, quote.pdfDocument.key) } } : quote;
  },
  async preview(id: string, officeBranchId: string, actor: AuditActor, contacts: MarketingContact[] = []) {
    const quote = await quotationRepository.findActive(id, officeBranchId);
    const approvedAt = new Date();
    const pdf = await renderQuotationPdf(quote, actor, approvedAt, true, contacts);
    const fileName = quote.no === null
      ? `quotation-preview-${id}.pdf`
      : `Q-${quote.no}-R${quote.revision}-${quote.numberYear}.pdf`;
    return { pdf, fileName };
  },
  async approve(id: string, input: unknown, officeBranchId: string, actor: AuditActor, contacts: MarketingContact[] = []) {
    const { version } = approveQuotationSchema.parse(input);
    const quote = await quotationRepository.findActive(id, officeBranchId);
    if (quote.version !== version) throw new HttpError('Quotation has changed; reload before retrying', 409);
    // Retrying the latest approved version returns the existing document, without another upload/history entry.
    if (quote.status === 'APPROVED' && quote.pdfDocument) {
      const document = quote.pdfDocument;
      return { ...quote, pdf: { ...document, ...await quotationStorage.downloadUrl(document.bucket, document.key) } };
    }
    if (!(approvableStatuses as readonly string[]).includes(quote.status)) throw new HttpError('Quotation status cannot be approved', 409);
    if (!quote.items.length) throw new HttpError('Quotation must contain active items before approval', 409);
    const bucket = quotationStorage.bucket();
    const key = `quotation/${officeBranchId}/${id}/r${quote.revision}/${randomUUID()}.pdf`;
    let uploaded = false;
    let download: Awaited<ReturnType<typeof quotationStorage.downloadUrl>> | undefined;
    try {
      const { quote: approved, syncEvent } = await quotationRepository.approve(id, version, officeBranchId, actor, async numbered => {
        const approvedAt = new Date();
        const pdf = await renderQuotationPdf(numbered, actor, approvedAt, false, contacts);
        const fileName = `Q-${numbered.no}-R${numbered.revision}-${numbered.numberYear}.pdf`;
        download = await quotationStorage.downloadUrl(bucket, key);
        uploaded = true; // Includes a PUT whose successful response is lost.
        await quotationStorage.upload(bucket, key, pdf, fileName);
        return { bucket, key, fileName, contentType: 'application/pdf', size: pdf.length,
          sha256: createHash('sha256').update(pdf).digest('hex'), revision: numbered.revision, version: numbered.version,
          approvedAt: approvedAt.toISOString(), approvedById: actor.id, approvedByName: actor.name };
      });
      // The outbox event is committed; attempt immediate delivery without failing approval.
      await processDueQuotationDeliveries(officeBranchId, syncEvent.id);
      wakeQuotationDelivery();
      return { ...approved, pdf: { ...approved.pdfDocument, ...download } };
    } catch (error) {
      if (uploaded) {
        // A database connection can fail after COMMIT. Never delete an object referenced by a committed approval.
        try {
          const stored = await quotationRepository.findPdf(bucket, key);
          if (stored) {
            const saved = await quotationRepository.find(id, officeBranchId);
            if (saved.pdfDocument?.id === stored.id) {
              return { ...saved, pdf: { ...stored, ...await quotationStorage.downloadUrl(bucket, key) } };
            }
          } else {
            await quotationStorage.remove(bucket, key);
          }
        } catch {
          logger.warn('Unable to reconcile quotation PDF; retain object for recovery', { quotationId: id, key });
        }
      }
      if (error instanceof HttpError) throw error;
      logger.error('Quotation PDF approval failed', { quotationId: id });
      throw new HttpError('Unable to generate or store quotation PDF; reload quotation before retrying', 503);
    }
  },
};
