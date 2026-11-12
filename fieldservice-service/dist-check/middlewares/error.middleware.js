"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = void 0;
const zod_1 = require("zod");
const client_1 = require("@prisma/client");
const env_js_1 = require("../config/env.js");
const errorDetails_js_1 = require("../utils/errorDetails.js");
const logger_js_1 = require("../utils/logger.js");
const errorHandler = (error, req, res, _next) => {
    const conflict = error instanceof client_1.Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(error.code);
    // A transaction that exceeded its own timeout (P2028) is a concurrency conflict,
    // not a server fault: the transaction rolled back, so the client can safely
    // reload and retry. Reporting it as 500 hid a recoverable state.
    const timedOut = error instanceof client_1.Prisma.PrismaClientKnownRequestError && error.code === 'P2028';
    const status = error instanceof zod_1.ZodError ? 400 : conflict ? 409 : timedOut ? 409 : (0, errorDetails_js_1.getErrorStatus)(error);
    const message = error instanceof zod_1.ZodError ? 'Invalid request data'
        : conflict ? 'Work order number already exists or concurrent update conflict; reload before retrying'
            : timedOut ? 'The request timed out while holding a work order lock; reload before retrying'
                : status >= 500 ? 'Internal server error' : (0, errorDetails_js_1.getErrorMessage)(error);
    const stack = (0, errorDetails_js_1.getErrorStack)(error);
    const metadata = { requestId: req.headers['x-request-id'], error: stack || error };
    if (status >= 500)
        logger_js_1.logger.error(message, metadata);
    else
        logger_js_1.logger.warn(message, metadata);
    res.status(status).json({
        status,
        success: false,
        message,
        ...(error instanceof zod_1.ZodError ? { errors: error.flatten() } : {}),
        requestId: req.headers['x-request-id'],
        ...(env_js_1.env.NODE_ENV === 'development' && stack && { stack }),
    });
};
exports.errorHandler = errorHandler;
//# sourceMappingURL=error.middleware.js.map