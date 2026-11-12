"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const cookie_parser_1 = __importDefault(require("cookie-parser"));
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const auth_middleware_js_1 = require("./middlewares/auth.middleware.js");
const error_middleware_js_1 = require("./middlewares/error.middleware.js");
const gateway_middleware_js_1 = require("./middlewares/gateway.middleware.js");
const requestId_middleware_js_1 = require("./middlewares/requestId.middleware.js");
const index_js_1 = __importDefault(require("./routes/index.js"));
const corsOrigin_js_1 = require("./utils/corsOrigin.js");
const app = (0, express_1.default)();
app.use((0, helmet_1.default)());
app.use(gateway_middleware_js_1.verifyGatewaySecret);
app.use((0, cors_1.default)({ origin: corsOrigin_js_1.corsOrigin, credentials: true, exposedHeaders: ['Content-Disposition'] }));
app.use(requestId_middleware_js_1.requestIdMiddleware);
app.use((0, cookie_parser_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 200,
        success: true,
        message: 'Field Service is healthy',
        data: {
            service: 'fieldservice-service',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
        },
        requestId: req.headers['x-request-id'],
    });
});
app.use(auth_middleware_js_1.authenticate);
app.use(index_js_1.default);
app.use((req, res) => {
    res.status(404).json({
        status: 404,
        success: false,
        message: `Route ${req.method} ${req.originalUrl} not found on Field Service`,
        requestId: req.headers['x-request-id'],
    });
});
app.use(error_middleware_js_1.errorHandler);
exports.default = app;
//# sourceMappingURL=app.js.map