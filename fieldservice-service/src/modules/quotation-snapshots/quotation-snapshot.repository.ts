import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/db.js';
import { quotationSchema, QuotationSnapshot } from '../../integrations/gateway.js';
import { HttpError } from '../../utils/httpError.js';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const date = z.string().datetime();

/** Event published by Marketing when a quotation is approved. */
export const quotationSyncEventSchema = z.object({
  eventId: z.string().uuid(),
  officeBranchId: z.string().uuid(),
  quotationId: z.string().uuid(),
  quotationVersion: z.number().int().nonnegative().max(2147483646),
  version: z.number().int().positive(),
  revision: z.number().int().nonnegative().max(2147483646),
  approvedAt: date,
  quotation: z.record(z.unknown()),
}).strict().superRefine((event, ctx) => {
  const quotation = event.quotation as Record<string, unknown>;
  if (quotation.id !== event.quotationId || quotation.officeBranchId !== event.officeBranchId
    || quotation.version !== event.quotationVersion) {
    ctx.addIssue({ code: 'custom', message: 'Quotation payload does not match the event identity' });
  }
});

/**
 * Atomically stores the approved quotation JSON. The advisory lock serializes
 * concurrent deliveries for a branch and the version guard makes retried or
 * reordered deliveries idempotent, mirroring the Finance tax cache receiver.
 */
export async function applyQuotationSyncEvent(input: unknown) {
  const parsed = quotationSyncEventSchema.safeParse(input);
  if (!parsed.success) throw new HttpError('Invalid quotation snapshot event', 400);
  const event = parsed.data;
  const quotation = quotationSchema.safeParse(event.quotation);
  if (!quotation.success) throw new HttpError('Invalid quotation snapshot payload', 400);
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'quotation-snapshot:' + event.officeBranchId}))`;
    const current = await tx.quotationSnapshot.findUnique({
      where: { officeBranchId_quotationId: { officeBranchId: event.officeBranchId, quotationId: event.quotationId } },
    });
    if (current && current.quotationVersion >= event.quotationVersion) return;
    await tx.quotationSnapshot.upsert({
      where: { officeBranchId_quotationId: { officeBranchId: event.officeBranchId, quotationId: event.quotationId } },
      create: { officeBranchId: event.officeBranchId, quotationId: event.quotationId,
        quotationVersion: event.quotationVersion, revision: event.revision, payload: json(event.quotation),
        eventId: event.eventId, approvedAt: new Date(event.approvedAt) },
      update: { quotationVersion: event.quotationVersion, revision: event.revision, payload: json(event.quotation),
        eventId: event.eventId, approvedAt: new Date(event.approvedAt) },
    });
  }, { maxWait: 5000, timeout: 20000 });
  return { success: true, eventId: event.eventId };
}

/**
 * Reads the synchronized APPROVED quotation snapshot for a work order basis.
 * Work orders never re-fetch quotation content from Marketing at create time.
 */
export async function loadStoredQuotation(quotationId: string, officeBranchId: string): Promise<QuotationSnapshot> {
  const row = await prisma.quotationSnapshot.findUnique({
    where: { officeBranchId_quotationId: { officeBranchId, quotationId } },
  });
  if (!row) throw new HttpError('Quotation snapshot not found in this branch; approve the quotation and retry', 404);
  const parsed = quotationSchema.safeParse(row.payload);
  if (!parsed.success) throw new HttpError('Stored quotation snapshot is invalid; resynchronize the quotation', 500);
  return parsed.data;
}
