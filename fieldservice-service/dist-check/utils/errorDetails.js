"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getErrorStatus = exports.getErrorStack = exports.getErrorMessage = void 0;
const getErrorMessage = (error, fallback = 'Internal Server Error') => error instanceof Error ? error.message : fallback;
exports.getErrorMessage = getErrorMessage;
const getErrorStack = (error) => error instanceof Error ? error.stack : undefined;
exports.getErrorStack = getErrorStack;
const getErrorStatus = (error) => {
    if (typeof error !== 'object' || error === null)
        return 500;
    const value = error;
    if (typeof value.statusCode === 'number')
        return value.statusCode;
    if (typeof value.status === 'number')
        return value.status;
    return 500;
};
exports.getErrorStatus = getErrorStatus;
//# sourceMappingURL=errorDetails.js.map