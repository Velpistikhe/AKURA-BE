"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const actor_middleware_js_1 = require("../../middlewares/actor.middleware.js");
const asyncHandler_js_1 = require("../../utils/asyncHandler.js");
const httpError_js_1 = require("../../utils/httpError.js");
const gateway_js_1 = require("../../integrations/gateway.js");
const work_order_repository_js_1 = require("./work-order.repository.js");
const work_order_schemas_js_1 = require("./work-order.schemas.js");
// The payload carries IDs only. Quotation and contract content is fetched live from
// Marketing and validated (branch, APPROVED state, contract effective period) before
// being reduced to the stored snapshot.
const resolveBasis = async (req, body, branch) => {
    if (body.quotationId)
        return (0, gateway_js_1.loadQuotationForBasis)(req, body.quotationId, branch);
    if (body.contractId)
        return (0, gateway_js_1.loadContract)(req, body.contractId, branch);
    return null;
};
const router = (0, express_1.Router)();
const actor = (res) => res.locals.workOrderActor;
const send = (req, res, data, status = 200) => res.status(status).json({ status, success: true, message: 'Request completed successfully', data, requestId: req.headers['x-request-id'] });
// Read-only reference used by Marketing to check whether a quotation still
// backs a live Work Order before it is revised or deleted. It exposes the
// Work Order identity and status only.
router.get('/by-quotation/:quotationId', actor_middleware_js_1.requireWorkOrderReferenceActor, (0, asyncHandler_js_1.asyncHandler)(async (req, res) => {
    const quotationId = zod_1.z.string().uuid().parse(req.params.quotationId);
    send(req, res, await work_order_repository_js_1.workOrderRepository.findActiveByQuotation(quotationId, actor(res)));
}));
router.use(actor_middleware_js_1.requireActor);
router.get('/', (0, asyncHandler_js_1.asyncHandler)(async (req, res) => { send(req, res, await work_order_repository_js_1.workOrderRepository.list(work_order_schemas_js_1.listWorkOrderSchema.parse(req.query), actor(res))); }));
router.get('/:id/history', (0, asyncHandler_js_1.asyncHandler)(async (req, res) => {
    const { page, limit } = work_order_schemas_js_1.workOrderHistorySchema.parse(req.query);
    send(req, res, await work_order_repository_js_1.workOrderRepository.history(work_order_schemas_js_1.workOrderIdSchema.parse(req.params.id), page, limit, actor(res)));
}));
router.get('/:id', (0, asyncHandler_js_1.asyncHandler)(async (req, res) => { send(req, res, await work_order_repository_js_1.workOrderRepository.get(work_order_schemas_js_1.workOrderIdSchema.parse(req.params.id), actor(res))); }));
// Company basis: the Work Order is not derived from a Marketing quotation. The
// company is validated live against Marketing, so an unknown, revoked or
// other-branch company is rejected before anything is stored.
router.post('/', actor_middleware_js_1.requireMarketingAdminOrUser, (0, asyncHandler_js_1.asyncHandler)(async (req, res) => {
    const input = work_order_schemas_js_1.createWorkOrderByCompanySchema.parse(req.body);
    const branch = actor(res).officeBranchId;
    const company = await (0, gateway_js_1.loadCompany)(req, input.companyId, branch);
    const contract = input.contractId ? await (0, gateway_js_1.loadContract)(req, input.contractId, branch) : null;
    const itemSnapshots = await Promise.all(input.items.map(async (item) => ({ ...item, snapshot: await (0, gateway_js_1.loadItemSizeReference)(req, item.itemSizeId) })));
    send(req, res, await work_order_repository_js_1.workOrderRepository.createByCompany(input, company, actor(res), contract, itemSnapshots), 201);
}));
// Quotation basis: the Work Order is derived from an approved Marketing
// quotation. The company is never taken from the client; it is read from the
// quotation company snapshot returned by Marketing.
router.post('/from-quotation', actor_middleware_js_1.requireMarketingAdminOrUser, (0, asyncHandler_js_1.asyncHandler)(async (req, res) => {
    const input = work_order_schemas_js_1.createWorkOrderByQuotationSchema.parse(req.body);
    const quotation = await (0, gateway_js_1.loadQuotationForBasis)(req, input.quotationId, actor(res).officeBranchId);
    // Marketing records the quotation link inside the same transaction that
    // creates the Work Order, so a failed callback rolls the Work Order back.
    send(req, res, await work_order_repository_js_1.workOrderRepository.createByQuotation(input, quotation, actor(res), row => (0, gateway_js_1.notifyMarketingWorkOrderStatus)(row, req)), 201);
}));
router.post('/:id/start', (0, actor_middleware_js_1.requireWorkOrderSection)('MARKETING'), (0, asyncHandler_js_1.asyncHandler)(async (req, res) => {
    const id = work_order_schemas_js_1.workOrderIdSchema.parse(req.params.id);
    const { version } = work_order_schemas_js_1.startWorkOrderSchema.parse(req.body);
    // The stored row is read first so a non-draft fails fast and the upstream
    // calls are only made for a draft in this branch; the upstream requests never
    // run inside a database transaction.
    const current = await work_order_repository_js_1.workOrderRepository.get(id, actor(res));
    if (current.version !== version || current.status !== 'DRAFT' || current.revoked)
        throw new httpError_js_1.HttpError('Work order has changed or is not a draft; reload before retrying', 409);
    const quote = current.quotationId ? await (0, gateway_js_1.loadQuotationForStart)(req, current.quotationId, actor(res).officeBranchId) : null;
    send(req, res, await work_order_repository_js_1.workOrderRepository.start(id, version, quote, actor(res), row => (0, gateway_js_1.notifyMarketingWorkOrderStatus)(row, req)));
}));
router.patch('/:id', (0, actor_middleware_js_1.requireWorkOrderSection)('MARKETING'), (0, asyncHandler_js_1.asyncHandler)(async (req, res) => {
    const id = work_order_schemas_js_1.workOrderIdSchema.parse(req.params.id), input = work_order_schemas_js_1.updateWorkOrderSchema.parse(req.body);
    const quotation = (input.quotationId !== undefined || input.contractId !== undefined)
        ? await resolveBasis(req, input, actor(res).officeBranchId) : null;
    send(req, res, await work_order_repository_js_1.workOrderRepository.update(id, input, quotation, actor(res), row => (0, gateway_js_1.notifyMarketingWorkOrderStatus)(row, req)));
}));
router.delete('/:id', (0, actor_middleware_js_1.requireWorkOrderSection)('MARKETING'), (0, asyncHandler_js_1.asyncHandler)(async (req, res) => {
    const { version } = work_order_schemas_js_1.deleteWorkOrderSchema.parse(req.body);
    send(req, res, await work_order_repository_js_1.workOrderRepository.revoke(work_order_schemas_js_1.workOrderIdSchema.parse(req.params.id), version, actor(res), row => (0, gateway_js_1.notifyMarketingWorkOrderStatus)({ ...row, revoked: true }, req)));
}));
exports.default = router;
//# sourceMappingURL=work-order.routes.js.map