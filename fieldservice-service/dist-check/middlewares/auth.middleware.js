"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = void 0;
const requestTokens_js_1 = require("../utils/requestTokens.js");
const tokens_js_1 = require("../utils/tokens.js");
const authenticate = async (req, res, next) => {
    const token = (0, requestTokens_js_1.getAccessToken)(req);
    if (!token) {
        res.status(401).json({
            status: 401,
            success: false,
            message: 'Unauthorized: missing access token',
            requestId: req.headers['x-request-id'],
        });
        return;
    }
    try {
        req.user = await (0, tokens_js_1.verifyAccessToken)(token);
        next();
    }
    catch {
        res.status(401).json({
            status: 401,
            success: false,
            message: 'Unauthorized: invalid or expired access token',
            requestId: req.headers['x-request-id'],
        });
    }
};
exports.authenticate = authenticate;
//# sourceMappingURL=auth.middleware.js.map