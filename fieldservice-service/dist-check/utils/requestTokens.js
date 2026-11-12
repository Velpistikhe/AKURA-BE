"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAccessToken = void 0;
const getAccessToken = (req) => {
    const authorization = req.headers.authorization;
    if (authorization?.startsWith('Bearer '))
        return authorization.slice(7);
    return req.cookies?.accessToken;
};
exports.getAccessToken = getAccessToken;
//# sourceMappingURL=requestTokens.js.map