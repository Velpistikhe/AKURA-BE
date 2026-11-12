"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyAccessToken = void 0;
const serviceUrl_js_1 = require("./serviceUrl.js");
const env_js_1 = require("../config/env.js");
let jwks;
const verifyAccessToken = async (token) => {
    const { createRemoteJWKSet, jwtVerify } = await import('jose');
    jwks ??= createRemoteJWKSet(new URL((0, serviceUrl_js_1.serviceUrl)('auth/.well-known/jwks.json')), {
        headers: (0, serviceUrl_js_1.serviceHeaders)('auth/.well-known/jwks.json'),
        timeoutDuration: 5_000,
        cooldownDuration: 30_000,
        cacheMaxAge: 10 * 60 * 1_000,
    });
    const { payload } = await jwtVerify(token, jwks, {
        algorithms: ['RS256'],
        issuer: env_js_1.env.JWT_ISSUER,
        audience: env_js_1.env.JWT_AUDIENCE,
    });
    if (!payload.sub || payload.type !== 'access') {
        throw new Error('Token is not a valid access token');
    }
    return payload;
};
exports.verifyAccessToken = verifyAccessToken;
//# sourceMappingURL=tokens.js.map