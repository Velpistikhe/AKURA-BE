"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const zod_1 = require("zod");
const actor_middleware_js_1 = require("../../middlewares/actor.middleware.js");
const asyncHandler_js_1 = require("../../utils/asyncHandler.js");
const gateway_js_1 = require("../../integrations/gateway.js");
const router = (0, express_1.Router)();
const actor = (res) => res.locals.workOrderActor;
const send = (req, res, data) => res.status(200).json({
    status: 200, success: true, message: 'Request completed successfully', data,
    requestId: req.headers['x-request-id'],
});
router.use(actor_middleware_js_1.requireActor);
/**
 * Branch-scoped quotation detail used by the Work Order creation form: the
 * approved quotation of the authenticated branch with its active item lines.
 * The lines are projected through an explicit allowlist, so no price field of
 * the Marketing quotation can reach the client.
 */
router.get('/quotations/:quotationId', (0, asyncHandler_js_1.asyncHandler)(async (req, res) => {
    const quotationId = zod_1.z.string().uuid().parse(req.params.quotationId);
    const quotation = await (0, gateway_js_1.loadQuotationForBasis)(req, quotationId, actor(res).officeBranchId);
    send(req, res, { quotation: {
            id: quotation.id, no: quotation.no, numberYear: quotation.numberYear,
            subject: quotation.subject, company: quotation.companySnapshot,
            items: quotation.items.filter(item => item.isActive !== false).map(item => ({
                itemSizeId: item.itemSizeId, serviceName: item.serviceName, serviceType: item.serviceType,
                itemName: item.itemName, size: item.size ?? null,
                quantityInspection: item.quantityInspection, quantityMaintenance: item.quantityMaintenance,
                inspectionScope: item.inspectionScopes ?? '', maintenanceScope: item.maintenanceScopes ?? '',
            })),
        } });
}));
/**
 * Branch-scoped approved quotations resolved live from Marketing. Marketing
 * returns active APPROVED quotations with any price source in the
 * authenticated branch and caps the list; the response shape is unchanged for
 * existing consumers.
 */
router.get('/quotations', (0, asyncHandler_js_1.asyncHandler)(async (req, res) => {
    const quotations = await (0, gateway_js_1.loadQuotationOptions)(req);
    send(req, res, { quotations: quotations.map(option => ({
            id: option.id,
            number: option.no ?? null,
            numberYear: option.numberYear ?? null,
            subject: option.subject ?? '',
            company: option.companySnapshot ?? null,
            quotationVersion: option.version,
            revision: option.revision,
            approvedAt: option.approvedAt,
        })) });
}));
exports.default = router;
//# sourceMappingURL=option.routes.js.map