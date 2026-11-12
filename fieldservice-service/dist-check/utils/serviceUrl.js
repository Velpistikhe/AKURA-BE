"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.serviceHeaders = exports.serviceUrl = void 0;
const env_js_1 = require("../config/env.js");
const validatePath = (path) => {
    if (!/^(auth|marketing|finance)\//.test(path) || path.includes('..') || path.includes('://'))
        throw new Error('Unsupported service path');
};
const serviceUrl = (path) => {
    validatePath(path);
    return `${env_js_1.env.API_GATEWAY_URL}/api/v1/${path}`;
};
exports.serviceUrl = serviceUrl;
const serviceHeaders = (path) => {
    validatePath(path);
    return { 'x-service-name': 'fieldservice-service', 'x-service-secret': env_js_1.env.GATEWAY_SECRET };
};
exports.serviceHeaders = serviceHeaders;
//# sourceMappingURL=serviceUrl.js.map