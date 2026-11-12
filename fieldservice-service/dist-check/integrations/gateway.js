"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contractSchema = exports.quotationReferenceOptionSchema = exports.quotationSchema = void 0;
exports.gatewayGet = gatewayGet;
exports.toQuotationSnapshot = toQuotationSnapshot;
exports.toWorkOrderItemSnapshot = toWorkOrderItemSnapshot;
exports.loadQuotationForStart = loadQuotationForStart;
exports.notifyMarketingWorkOrderStatus = notifyMarketingWorkOrderStatus;
exports.loadCompany = loadCompany;
exports.loadQuotationForBasis = loadQuotationForBasis;
exports.loadQuotationOptions = loadQuotationOptions;
exports.toContractSnapshot = toContractSnapshot;
exports.loadContract = loadContract;
exports.loadItemSizeReference = loadItemSizeReference;
exports.validateContract = validateContract;
const zod_1 = require("zod");
const serviceUrl_js_1 = require("../utils/serviceUrl.js");
const requestTokens_js_1 = require("../utils/requestTokens.js");
const httpError_js_1 = require("../utils/httpError.js");
const env_js_1 = require("../config/env.js");
async function gatewayGet(path, req) {
    const token = (0, requestTokens_js_1.getAccessToken)(req);
    if (!token)
        throw new httpError_js_1.HttpError('Access token is required', 401);
    const user = req.user;
    if (!user)
        throw new httpError_js_1.HttpError('Verified user is required', 401);
    const viaGateway = req.res?.locals.arrivedViaGateway === true;
    const requestId = String(req.headers['x-request-id'] ?? '');
    let response;
    try {
        if (path === 'auth/me' && !viaGateway) {
            response = await fetch(`${env_js_1.env.API_GATEWAY_URL}/api/v1/auth/me`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...(requestId ? { 'x-request-id': requestId } : {}),
                },
                signal: AbortSignal.timeout(5000),
            });
        }
        else {
            response = await fetch((0, serviceUrl_js_1.serviceUrl)(path), {
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...(0, serviceUrl_js_1.serviceHeaders)(path),
                    ...(requestId ? { 'x-request-id': requestId } : {}),
                },
                signal: AbortSignal.timeout(5000),
            });
        }
    }
    catch {
        throw new httpError_js_1.HttpError('Referenced service is unavailable; retry later', 503);
    }
    if (!response.ok) {
        // A 400/422 means the upstream rejected the reference we sent, so the
        // request itself is invalid; reporting it as 503 hid the real cause
        // behind an "upstream unavailable" message.
        const status = [400, 401, 403, 404, 409, 422].includes(response.status) ? response.status : 503;
        const message = status === 404 ? 'Referenced record not found'
            : status === 400 || status === 422 ? 'Referenced record was rejected by the upstream service'
                : status === 409 ? 'Referenced record conflicts with the current state of the upstream service'
                    : status === 401 || status === 403 ? 'Unable to validate reference with upstream service'
                        : 'Referenced service is unavailable; retry later';
        throw new httpError_js_1.HttpError(message, status);
    }
    try {
        return (await response.json()).data;
    }
    catch {
        throw new httpError_js_1.HttpError('Invalid response from referenced service', 502);
    }
}
const money = zod_1.z.string().regex(/^\d{1,16}(\.\d{1,2})?$/);
const dateTime = zod_1.z.string().datetime();
// Item shape returned by GET marketing/quotation-references/:id. Price fields are
// validated here so an incomplete upstream payload still fails as 502, but they are
// deliberately dropped by toQuotationSnapshot and never persisted.
const quotationItemSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(), itemSizeId: zod_1.z.string().uuid(), position: zod_1.z.number().int(),
    serviceName: zod_1.z.string(), serviceType: zod_1.z.string(), itemName: zod_1.z.string(),
    size: zod_1.z.string().nullish(), note: zod_1.z.string().nullish(),
    quantityInspection: zod_1.z.string(), quantityMaintenance: zod_1.z.string(),
    priceInspection: money, priceMaintenance: money.nullable(), subTotal: money,
    priceSelection: zod_1.z.record(zod_1.z.unknown()).nullable(), isActive: zod_1.z.boolean(), version: zod_1.z.number().int(),
    // Frozen scope snapshot of the line, exposed by Marketing on the reference.
    inspectionScopes: zod_1.z.string().nullish(), maintenanceScopes: zod_1.z.string().nullish(),
}).passthrough();
// Quotation header returned by GET marketing/quotation-references/:id. The tax
// rate is validated and persisted in the Work Order snapshot; the total fields
// stay excluded from the persisted snapshot by toQuotationSnapshot.
exports.quotationSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(), officeBranchId: zod_1.z.string().uuid(), version: zod_1.z.number().int().nonnegative(),
    // Boolean (not literal true) so lifecycle snapshots such as REVISED can also be stored.
    isActive: zod_1.z.boolean(),
    // Numbering is assigned only at approval, so a pre-approval quotation legitimately
    // arrives with no/numberYear null and must still fail as "not APPROVED", not as 502.
    no: zod_1.z.number().int().nullable(), numberYear: zod_1.z.number().int().nullable(),
    status: zod_1.z.string(), revision: zod_1.z.number().int().nonnegative(),
    date: dateTime.nullable(), jobStart: zod_1.z.string(), inquiryMethod: zod_1.z.string(), inquiryDate: dateTime,
    subject: zod_1.z.string(), termOfPayment: zod_1.z.string(), validity: zod_1.z.string(),
    supplyAkura: zod_1.z.string(), supplyCustomer: zod_1.z.string(), location: zod_1.z.string(), accomplished: zod_1.z.string(),
    deliveryReports: zod_1.z.string(), deliveryInvoice: zod_1.z.string(), staffId: zod_1.z.string().uuid(),
    customerSnapshot: zod_1.z.string(), companySnapshot: zod_1.z.record(zod_1.z.unknown()),
    subTotal: money, tax: money, taxAmount: money, total: money, createdAt: dateTime, updatedAt: dateTime,
    items: zod_1.z.array(quotationItemSchema),
}).passthrough();
// The exact quotation fields a Work Order stores: identity, lifecycle and descriptive
// content. Prices are absent by construction.
const quotationItemSnapshotKeys = [
    'id', 'itemSizeId', 'position', 'serviceName', 'serviceType', 'itemName',
    'size', 'note', 'quantityInspection', 'quantityMaintenance', 'isActive', 'version',
];
const quotationSnapshotKeys = [
    'id', 'officeBranchId', 'no', 'numberYear', 'revision', 'date', 'jobStart', 'inquiryMethod',
    'inquiryDate', 'subject', 'termOfPayment', 'validity', 'supplyAkura', 'supplyCustomer',
    'location', 'accomplished', 'deliveryReports', 'deliveryInvoice', 'customerSnapshot',
    'companySnapshot', 'staffId', 'status', 'isActive', 'version', 'createdAt', 'updatedAt',
    // The tax rate approved on the quotation is part of the document identity and
    // is kept so Finance can compare a billing request against the Work Order
    // executed for the same quotation. Amounts (subTotal/taxAmount/total) and every
    // item price stay excluded.
    'tax',
];
/**
 * Reduces a live Marketing quotation to what a Work Order stores: identity, lifecycle
 * and descriptive content plus its items, with every price excluded (header
 * subTotal/taxAmount/total, item priceInspection/priceMaintenance/subTotal/priceSelection).
 * The approved tax rate is kept because it identifies the document, not a price.
 *
 * Keys are projected through an explicit allowlist rather than a rest-spread, so the
 * upstream passthrough() payload cannot leak an extra Marketing column into the column,
 * and no price field can be stored by accident.
 */
function toQuotationSnapshot(quotation) {
    return {
        ...Object.fromEntries(quotationSnapshotKeys.map(key => [key, quotation[key]])),
        items: quotation.items.map(item => Object.fromEntries(quotationItemSnapshotKeys.map(key => [key, item[key]]))),
    };
}
/**
 * Builds the stored item snapshot from a live quotation line. The description is
 * taken from the quotation line (its historical catalog snapshot) and the scopes
 * from the frozen scope snapshot of that line, so the Work Order item matches the
 * approved document even after the catalog changes.
 */
function toWorkOrderItemSnapshot(item) {
    return {
        itemSizeId: item.itemSizeId, serviceName: item.serviceName,
        inspectionScope: item.inspectionScopes ?? '', maintenanceScope: item.maintenanceScopes ?? '',
        itemName: item.itemName, size: item.size ?? null,
    };
}
/**
 * Live Marketing validation used when a quotation-based Work order starts.
 * Marketing is the source of truth: network failure/timeout/5xx means Marketing
 * is unavailable (503); a 404 or any inactive/non-approved quotation means the
 * local snapshot no longer matches Marketing (409 mismatch).
 */
async function loadQuotationForStart(req, id, branch) {
    const token = (0, requestTokens_js_1.getAccessToken)(req);
    if (!token)
        throw new httpError_js_1.HttpError('Access token is required', 401);
    const user = req.user;
    if (!user)
        throw new httpError_js_1.HttpError('Verified user is required', 401);
    const path = `marketing/quotation-references/${id}`;
    const mismatch = 'Work order quotation snapshot does not match Marketing data; reload the quotation';
    let response;
    try {
        response = await fetch((0, serviceUrl_js_1.serviceUrl)(path), {
            headers: { Authorization: `Bearer ${token}`, ...(0, serviceUrl_js_1.serviceHeaders)(path),
                'x-request-id': String(req.headers['x-request-id'] ?? '') },
            signal: AbortSignal.timeout(5000),
        });
    }
    catch {
        throw new httpError_js_1.HttpError('Marketing service is currently unavailable; retry later', 503);
    }
    // 404 means Marketing no longer exposes the quotation (inactive, revised or
    // removed): the stored snapshot has drifted from the source of truth.
    if (response.status === 404)
        throw new httpError_js_1.HttpError(mismatch, 409);
    if (response.status === 401 || response.status === 403)
        throw new httpError_js_1.HttpError('Unable to validate the quotation with Marketing service', response.status);
    if (!response.ok)
        throw new httpError_js_1.HttpError('Marketing service is currently unavailable; retry later', 503);
    let payload;
    try {
        payload = (await response.json()).data;
    }
    catch {
        throw new httpError_js_1.HttpError('Invalid response from Marketing service', 502);
    }
    const parsed = exports.quotationSchema.safeParse(payload);
    if (!parsed.success)
        throw new httpError_js_1.HttpError('Invalid Marketing quotation response', 502);
    const quotation = parsed.data;
    if (quotation.id !== id || quotation.officeBranchId !== branch)
        throw new httpError_js_1.HttpError(mismatch, 409);
    if (!quotation.isActive || quotation.status !== 'APPROVED')
        throw new httpError_js_1.HttpError(mismatch, 409);
    return quotation;
}
/**
 * Notifies Marketing of a Work Order status transition. For revokes the callback
 * also clears the quotation reference; it is synchronous so any failure aborts
 * the Field Service transaction and the two services remain consistent.
 */
async function notifyMarketingWorkOrderStatus(workOrder, req) {
    if (!workOrder.quotationId)
        return;
    if (!env_js_1.env.WORK_ORDER_SYNC_SECRET)
        throw new httpError_js_1.HttpError('Work Order callback credentials are not configured', 503);
    const callbackPath = `marketing/internal/quotations/${workOrder.quotationId}/work-order`;
    let response;
    try {
        response = await fetch((0, serviceUrl_js_1.serviceUrl)(callbackPath), {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
            headers: { 'content-type': 'application/json', 'x-work-order-sync-secret': env_js_1.env.WORK_ORDER_SYNC_SECRET,
                ...(0, serviceUrl_js_1.serviceHeaders)(callbackPath), ...(typeof req.headers['x-request-id'] === 'string' ? { 'x-request-id': req.headers['x-request-id'] } : {}) },
            body: JSON.stringify({ workOrderId: workOrder.id, workOrderNumber: workOrder.number, workOrderStatus: workOrder.status,
                officeBranchId: workOrder.officeBranchId, revoked: workOrder.revoked === true }),
        });
    }
    catch {
        throw new httpError_js_1.HttpError('Marketing Service is unavailable; Work Order status change was not applied', 503);
    }
    if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new httpError_js_1.HttpError(body?.message || 'Marketing Service rejected the Work Order status change', response.status === 404 || response.status === 409 ? response.status : 503);
    }
    const acknowledgment = await response.json().catch(() => null);
    if (acknowledgment?.success !== true || acknowledgment.workOrderId !== workOrder.id) {
        throw new httpError_js_1.HttpError('Invalid acknowledgment from Marketing Service; Work Order status change was not applied', 502);
    }
}
const companySchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    officeBranchId: zod_1.z.string().uuid(),
    name: zod_1.z.string().min(1),
    revoked: zod_1.z.boolean(),
}).passthrough();
/** Live company profile from Marketing; only non-revoked companies in the caller branch are accepted. */
async function loadCompany(req, companyId, branch) {
    const parsed = companySchema.safeParse(await gatewayGet(`marketing/companies/${companyId}`, req));
    if (!parsed.success)
        throw new httpError_js_1.HttpError('Invalid company response', 502);
    const company = parsed.data;
    if (company.id !== companyId || company.officeBranchId !== branch)
        throw new httpError_js_1.HttpError('Company not found', 404);
    if (company.revoked)
        throw new httpError_js_1.HttpError('Company is not active', 409);
    return company;
}
async function loadQuotationForBasis(req, id, branch) {
    const parsed = exports.quotationSchema.safeParse(await gatewayGet(`marketing/quotation-references/${id}`, req));
    if (!parsed.success)
        throw new httpError_js_1.HttpError('Invalid quotation response', 502);
    const quotation = parsed.data;
    if (quotation.id !== id || quotation.officeBranchId !== branch)
        throw new httpError_js_1.HttpError('Quotation not found', 404);
    if (!quotation.isActive || quotation.status !== 'APPROVED')
        throw new httpError_js_1.HttpError('Work order requires an APPROVED quotation', 409);
    return quotation;
}
exports.quotationReferenceOptionSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(), officeBranchId: zod_1.z.string().uuid(),
    no: zod_1.z.number().int().nullable(), numberYear: zod_1.z.number().int().nullable(),
    subject: zod_1.z.string(), companySnapshot: zod_1.z.record(zod_1.z.unknown()),
    version: zod_1.z.number().int().nonnegative(), revision: zod_1.z.number().int().nonnegative(),
    approvedAt: zod_1.z.string().datetime().nullable(),
}).passthrough();
/** Branch-scoped list of APPROVED, active quotation options with any price source. */
async function loadQuotationOptions(req) {
    const parsed = zod_1.z.object({ quotations: zod_1.z.array(exports.quotationReferenceOptionSchema) }).passthrough()
        .safeParse(await gatewayGet('marketing/quotation-references', req));
    if (!parsed.success)
        throw new httpError_js_1.HttpError('Invalid quotation reference list response', 502);
    const branch = req.user?.officeBranchId;
    if (!branch || parsed.data.quotations.some(quotation => quotation.officeBranchId !== branch)) {
        throw new httpError_js_1.HttpError('Quotation reference list does not match the authenticated branch', 502);
    }
    return parsed.data.quotations;
}
const contractDate = zod_1.z.union([zod_1.z.string().datetime(), zod_1.z.string().date()])
    .transform(value => value.length === 10 ? `${value}T00:00:00.000Z` : value);
exports.contractSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(), version: zod_1.z.number().int().nonnegative(), companyId: zod_1.z.string().uuid(),
    isActive: zod_1.z.boolean().optional(), isDeleted: zod_1.z.boolean().optional(), status: zod_1.z.string(), effectiveFrom: contractDate, effectiveUntil: contractDate,
    contractNumber: zod_1.z.string().min(1), contractDate,
    company: zod_1.z.object({ id: zod_1.z.string().uuid(), name: zod_1.z.string().min(1), officeBranchId: zod_1.z.string().uuid(), revoked: zod_1.z.boolean() }).passthrough(),
}).passthrough()
    .refine(value => value.isActive !== undefined || value.isDeleted !== undefined, 'Contract lifecycle state is required')
    .transform(value => ({ ...value, isActive: value.isActive !== false && value.isDeleted !== true }));
function toContractSnapshot(contract) {
    return {
        id: contract.id, version: contract.version, contractNumber: contract.contractNumber,
        contractDate: contract.contractDate, effectiveFrom: contract.effectiveFrom,
        effectiveUntil: contract.effectiveUntil, companyId: contract.companyId, companyName: contract.company.name,
    };
}
async function loadContract(req, id, branch) {
    const parsed = exports.contractSchema.safeParse(await gatewayGet(`marketing/contract-references/${id}`, req));
    if (!parsed.success)
        throw new httpError_js_1.HttpError('Invalid contract response', 502);
    const contract = parsed.data;
    if (contract.id !== id || contract.company.officeBranchId !== branch || contract.company.id !== contract.companyId)
        throw new httpError_js_1.HttpError('Contract not found', 404);
    validateContract(contract);
    return contract;
}
/**
 * The catalog identity of one item size, read live from Marketing. Used by the
 * Work Order item snapshot when the document basis carries no quotation line
 * (contract basis), so the stored description is never invented
 * by the client.
 */
const itemSizeReferenceSchema = zod_1.z.object({
    itemSizeId: zod_1.z.string().uuid(), serviceName: zod_1.z.string(),
    inspectionScope: zod_1.z.string(), maintenanceScope: zod_1.z.string(),
    itemName: zod_1.z.string(), size: zod_1.z.string().nullable(),
}).passthrough();
async function loadItemSizeReference(req, id) {
    const parsed = itemSizeReferenceSchema.safeParse(await gatewayGet(`marketing/item-size-references/${id}`, req));
    if (!parsed.success)
        throw new httpError_js_1.HttpError('Invalid item size response', 502);
    if (parsed.data.itemSizeId !== id)
        throw new httpError_js_1.HttpError('Item size not found', 404);
    return parsed.data;
}
function validateContract(contract) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    // Marketing's CompanyContractStatus is DRAFT|SUBMITTED|REJECTED|APPROVED|REVISED|TERMINATED,
    // so APPROVED (not ACTIVE) is the only live state of a contract.
    if (!contract.isActive || contract.status !== 'APPROVED' || contract.company.revoked
        || contract.effectiveFrom.slice(0, 10) > today || contract.effectiveUntil.slice(0, 10) <= today)
        throw new httpError_js_1.HttpError('Work order requires an APPROVED contract within its effective period', 409);
}
//# sourceMappingURL=gateway.js.map