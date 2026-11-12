"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isGatewayOnlyPath = exports.allowsLocalDirectAccess = void 0;
const env_js_1 = require("../config/env.js");
const allowsLocalDirectAccess = () => env_js_1.env.NODE_ENV === 'development' && process.env.VERCEL !== '1';
exports.allowsLocalDirectAccess = allowsLocalDirectAccess;
const isGatewayOnlyPath = (req) => req.path === '/internal' || req.path.startsWith('/internal/');
exports.isGatewayOnlyPath = isGatewayOnlyPath;
//# sourceMappingURL=localDirectAccess.js.map