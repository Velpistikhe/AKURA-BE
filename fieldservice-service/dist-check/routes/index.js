"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const work_order_routes_js_1 = __importDefault(require("../modules/work-orders/work-order.routes.js"));
const option_routes_js_1 = __importDefault(require("../modules/options/option.routes.js"));
const router = (0, express_1.Router)();
router.use('/work-orders', work_order_routes_js_1.default);
router.use('/options', option_routes_js_1.default);
exports.default = router;
//# sourceMappingURL=index.js.map