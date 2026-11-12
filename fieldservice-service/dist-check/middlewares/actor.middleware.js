"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireMarketingAdminOrUser = exports.requireWorkOrderSection = exports.requireWorkOrderReferenceActor = exports.requireActor = void 0;
const zod_1 = require("zod");
const gateway_js_1 = require("../integrations/gateway.js");
const httpError_js_1 = require("../utils/httpError.js");
const profileSchema = zod_1.z.object({ id: zod_1.z.string().uuid(), officeBranchId: zod_1.z.string().uuid().nullable(), isActive: zod_1.z.boolean(), role: zod_1.z.string(), section: zod_1.z.string().nullable(), firstName: zod_1.z.string(), lastName: zod_1.z.string(), username: zod_1.z.string() });
const resolveActor = (sections) => async (req, res, next) => {
    try {
        const result = profileSchema.safeParse(await (0, gateway_js_1.gatewayGet)('auth/me', req));
        if (!result.success)
            throw new httpError_js_1.HttpError('Invalid user profile response', 502);
        const profile = result.data;
        if (profile.id !== req.user?.sub)
            throw new httpError_js_1.HttpError('User identity mismatch', 401);
        if (!profile.isActive || !profile.officeBranchId)
            throw new httpError_js_1.HttpError('Active user and office branch assignment are required', 403);
        if (req.user?.officeBranchId !== profile.officeBranchId)
            throw new httpError_js_1.HttpError('Office branch assignment has changed; please sign in again', 401);
        if (!['ADMIN', 'APP_MANAGER'].includes(profile.role) && !sections.includes(profile.section ?? ''))
            throw new httpError_js_1.HttpError('Access to this section is required', 403);
        res.locals.workOrderSection = profile.section;
        res.locals.workOrderRole = profile.role;
        res.locals.workOrderActor = { id: profile.id, name: `${profile.firstName} ${profile.lastName}`.trim() || profile.username, officeBranchId: profile.officeBranchId };
        next();
    }
    catch (error) {
        next(error);
    }
};
exports.requireActor = resolveActor(['MARKETING', 'FIELD_SERVICE']);
exports.requireWorkOrderReferenceActor = resolveActor(['MARKETING', 'FIELD_SERVICE', 'FINANCE', 'ACCOUNTING']);
const requireWorkOrderSection = (...sections) => (_req, res, next) => {
    if (!sections.includes(res.locals.workOrderSection))
        return next(new httpError_js_1.HttpError('Access to this section is required', 403));
    next();
};
exports.requireWorkOrderSection = requireWorkOrderSection;
/** POST work-order creation: MARKETING section with ADMIN or USER role only. */
const requireMarketingAdminOrUser = (_req, res, next) => {
    if (res.locals.workOrderSection !== 'MARKETING')
        return next(new httpError_js_1.HttpError('Access to this section is required', 403));
    const role = res.locals.workOrderRole;
    if (role !== 'ADMIN' && role !== 'USER')
        return next(new httpError_js_1.HttpError('ADMIN or USER role is required', 403));
    next();
};
exports.requireMarketingAdminOrUser = requireMarketingAdminOrUser;
//# sourceMappingURL=actor.middleware.js.map