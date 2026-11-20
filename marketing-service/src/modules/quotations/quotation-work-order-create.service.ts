import { prisma } from '../../config/db.js';
import { AuditActor } from '../../types/auth.types.js';
import { HttpError } from '../../utils/httpError.js';
import { serviceHeaders, serviceUrl } from '../../utils/serviceUrl.js';
import { quotationRepository } from './quotation.repository.js';
import { CreateWorkOrderFromQuotationBody } from './quotation.schemas.js';

const decimalString = (value: unknown): string => {
  if (value === null || value === undefined) throw new HttpError('Invalid quotation amount', 500);
  return typeof value === 'object' && value !== null && 'toString' in (value as object)
    ? (value as { toString: () => string }).toString()
    : String(value);
};

const isoDateTime = (value: Date | null): string | null => (value ? value.toISOString() : null);

const isoDateOnly = (value: Date): string => value.toISOString().slice(0, 10);

const serializeWorkOrderInput = (
  quotationId: string,
  input: CreateWorkOrderFromQuotationBody,
): Record<string, unknown> => ({
  quotationId,
  startDate: isoDateOnly(input.startDate),
  endDate: isoDateOnly(input.endDate),
  ...(input.subject !== undefined ? { subject: input.subject } : {}),
  ...(input.officialReport !== undefined ? { officialReport: input.officialReport } : {}),
  ...(input.dailyReport !== undefined ? { dailyReport: isoDateOnly(input.dailyReport) } : {}),
  ...(input.officialReportDelivery !== undefined ? { officialReportDelivery: isoDateOnly(input.officialReportDelivery) } : {}),
  ...(input.dailyReportDelivery !== undefined ? { dailyReportDelivery: isoDateOnly(input.dailyReportDelivery) } : {}),
  ...(input.poNumber !== undefined ? { poNumber: input.poNumber } : {}),
  ...(input.poDate !== undefined ? { poDate: isoDateOnly(input.poDate) } : {}),
  inspectors: input.inspectors,
  items: input.items,
});
export const quotationReferencePayload = (
  quote: Awaited<ReturnType<typeof quotationRepository.findActive>>,
): unknown => JSON.parse(JSON.stringify({
  ...quote,
  date: isoDateTime(quote.date),
  inquiryDate: quote.inquiryDate.toISOString(),
  createdAt: quote.createdAt.toISOString(),
  updatedAt: quote.updatedAt.toISOString(),
  subTotal: decimalString(quote.subTotal),
  tax: decimalString(quote.tax),
  taxAmount: decimalString(quote.taxAmount),
  total: decimalString(quote.total),
  items: quote.items.map(item => ({
    ...item,
    quantityInspection: decimalString(item.quantityInspection),
    quantityMaintenance: decimalString(item.quantityMaintenance),
    priceInspection: decimalString(item.priceInspection),
    priceMaintenance: item.priceMaintenance !== null ? decimalString(item.priceMaintenance) : null,
    subTotal: decimalString(item.subTotal),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  })),
  workOrderId: quote.workOrderId ?? null,
}));

const lockAndAssertQuotation = async (quotationId: string, officeBranchId: string): Promise<void> => {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "quotations" WHERE id = ${quotationId}::uuid AND office_branch_id = ${officeBranchId}::uuid FOR UPDATE`;
    const quote = await tx.quotation.findFirst({
      where: { id: quotationId, officeBranchId },
      select: { id: true, isActive: true, status: true, hasWorkOrder: true, workOrderId: true },
    });
    if (!quote) throw new HttpError('Quotation not found', 404);
    if (!quote.isActive) throw new HttpError('Quotation not found', 404);
    if (quote.status !== 'APPROVED') throw new HttpError('Quotation must be APPROVED before creating a Work Order', 409);
    if (quote.hasWorkOrder || quote.workOrderId) throw new HttpError('Quotation already has a Work Order', 409);
  }, { maxWait: 10000, timeout: 20000 });
};

async function revokeCompensatingWorkOrder(workOrderId: string, version: number, accessToken: string, requestId?: string): Promise<void> {
  const path = `fieldservice/work-orders/${workOrderId}`;
  try {
    await fetch(serviceUrl(path), {
      method: 'DELETE',
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        ...serviceHeaders(path),
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      body: JSON.stringify({ version }),
    });
  } catch {
    // The orphan is logged only through the thrown error to the caller.
  }
}

export async function createWorkOrderFromQuotation(
  quotationId: string,
  officeBranchId: string,
  input: CreateWorkOrderFromQuotationBody,
  actor: AuditActor,
  accessToken: string,
  requestId?: string,
) {
  await lockAndAssertQuotation(quotationId, officeBranchId);
  const reference = await quotationRepository.findActive(quotationId, officeBranchId);
  const path = 'fieldservice/internal/work-orders/from-quotation';
  const workOrderInput = serializeWorkOrderInput(quotationId, input);
  let response: globalThis.Response;
  try {
    response = await fetch(serviceUrl(path), {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
      headers: {
        'content-type': 'application/json',
        ...serviceHeaders(path),
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      body: JSON.stringify({
        officeBranchId,
        quotationId,
        actor: { id: actor.id, name: actor.name },
        quotation: quotationReferencePayload(reference),
        workOrder: workOrderInput,
      }),
    });
  } catch {
    throw new HttpError('Field Service is currently unavailable; retry later', 503);
  }
  const payload = await response.json().catch(() => null) as { data?: Record<string, unknown>; message?: string } | null;
  if (!response.ok) {
    const status = [400, 404, 409, 422].includes(response.status) ? response.status : 503;
    throw new HttpError(typeof payload?.message === 'string' ? payload.message : 'Field Service rejected the work order request', status);
  }
  const workOrder = payload?.data;
  if (!workOrder || typeof workOrder !== 'object' || typeof (workOrder as { id?: unknown }).id !== 'string') {
    throw new HttpError('Invalid work order response from Field Service', 502);
  }
  const wo = workOrder as { id: string; number: string; status: string; version: number };
  try {
    const quotation = await quotationRepository.attachWorkOrder(
      quotationId,
      officeBranchId,
      { id: wo.id, number: wo.number, status: wo.status, quotationId },
      workOrder,
      actor,
    );
    return { workOrder, quotation };
  } catch (error) {
    await revokeCompensatingWorkOrder(wo.id, wo.version, accessToken, requestId);
    throw error;
  }
}