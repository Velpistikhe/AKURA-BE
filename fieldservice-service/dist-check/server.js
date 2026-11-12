"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const app_js_1 = __importDefault(require("./app.js"));
const db_js_1 = require("./config/db.js");
const env_js_1 = require("./config/env.js");
const errorDetails_js_1 = require("./utils/errorDetails.js");
const logger_js_1 = require("./utils/logger.js");
const startServer = async () => {
    try {
        await (0, db_js_1.connectDb)();
        const server = app_js_1.default.listen(env_js_1.env.PORT, () => {
            logger_js_1.logger.info(`Field Service is running on port ${env_js_1.env.PORT} [${env_js_1.env.NODE_ENV}]`);
            logger_js_1.logger.info(`Health check: http://localhost:${env_js_1.env.PORT}/health`);
        });
        const gracefulShutdown = (signal) => {
            logger_js_1.logger.info(`Received ${signal}. Gracefully shutting down Field Service...`);
            server.close(() => {
                void (0, db_js_1.disconnectDb)().finally(() => process.exit(0));
            });
            setTimeout(() => process.exit(1), 10_000).unref();
        };
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    }
    catch (error) {
        logger_js_1.logger.error('Failed to start Field Service:', { error: (0, errorDetails_js_1.getErrorMessage)(error) });
        process.exit(1);
    }
};
void startServer();
//# sourceMappingURL=server.js.map