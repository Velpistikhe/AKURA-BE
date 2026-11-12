"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyGatewaySecret = void 0;
const env_js_1 = require("../config/env.js");
const localDirectAccess_js_1 = require("../utils/localDirectAccess.js");
const verifyGatewaySecret = (req, res, next) => {
    const secret = req.headers['x-gateway-secret'];
    if (typeof secret === 'string' && secret === env_js_1.env.GATEWAY_SECRET) {
        res.locals.arrivedViaGateway = true;
        next();
        return;
    }
    if (req.method === 'OPTIONS' && (0, localDirectAccess_js_1.allowsLocalDirectAccess)()) {
        res.locals.arrivedViaGateway = false;
        next();
        return;
    }
    if ((0, localDirectAccess_js_1.allowsLocalDirectAccess)() && !(0, localDirectAccess_js_1.isGatewayOnlyPath)(req)) {
        res.locals.arrivedViaGateway = false;
        next();
        return;
    }
    res.status(403).json({
        status: 403,
        success: false,
        message: 'Access denied: requests must pass through the API Gateway',
        requestId: req.headers['x-request-id'],
    });
};
exports.verifyGatewaySecret = verifyGatewaySecret;
//# sourceMappingURL=gateway.middleware.js.map