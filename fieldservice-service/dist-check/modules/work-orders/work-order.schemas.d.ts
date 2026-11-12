import { z } from 'zod';
/** POST /work-orders — company basis; companyId is validated live against Marketing. */
export declare const createWorkOrderByCompanySchema: z.ZodObject<{
    contractId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    startDate: z.ZodEffects<z.ZodString, Date, string>;
    endDate: z.ZodOptional<z.ZodEffects<z.ZodString, Date, string>>;
    inspectors: z.ZodEffects<z.ZodArray<z.ZodString, "many">, string[], string[]>;
    items: z.ZodArray<z.ZodObject<{
        itemSizeId: z.ZodString;
        quantityInspection: z.ZodEffects<z.ZodNumber, number, number>;
        quantityMaintenance: z.ZodEffects<z.ZodNumber, number, number>;
    }, "strict", z.ZodTypeAny, {
        itemSizeId: string;
        quantityInspection: number;
        quantityMaintenance: number;
    }, {
        itemSizeId: string;
        quantityInspection: number;
        quantityMaintenance: number;
    }>, "many">;
    companyId: z.ZodString;
    subject: z.ZodString;
    officialReport: z.ZodBoolean;
    dailyReport: z.ZodEffects<z.ZodString, Date, string>;
    officialReportDelivery: z.ZodEffects<z.ZodString, Date, string>;
    dailyReportDelivery: z.ZodEffects<z.ZodString, Date, string>;
    poNumber: z.ZodString;
    poDate: z.ZodEffects<z.ZodString, Date, string>;
}, "strict", z.ZodTypeAny, {
    subject: string;
    items: {
        itemSizeId: string;
        quantityInspection: number;
        quantityMaintenance: number;
    }[];
    companyId: string;
    startDate: Date;
    inspectors: string[];
    officialReport: boolean;
    dailyReport: Date;
    officialReportDelivery: Date;
    dailyReportDelivery: Date;
    poNumber: string;
    poDate: Date;
    contractId?: string | null | undefined;
    endDate?: Date | undefined;
}, {
    subject: string;
    items: {
        itemSizeId: string;
        quantityInspection: number;
        quantityMaintenance: number;
    }[];
    companyId: string;
    startDate: string;
    inspectors: string[];
    officialReport: boolean;
    dailyReport: string;
    officialReportDelivery: string;
    dailyReportDelivery: string;
    poNumber: string;
    poDate: string;
    contractId?: string | null | undefined;
    endDate?: string | undefined;
}>;
/** POST /work-orders/from-quotation — quotation basis; companyId is taken from the quotation snapshot only. */
export declare const createWorkOrderByQuotationSchema: z.ZodObject<{
    inspectors: z.ZodEffects<z.ZodArray<z.ZodString, "many">, string[], string[]>;
    items: z.ZodArray<z.ZodObject<{
        itemSizeId: z.ZodString;
        quantityInspection: z.ZodEffects<z.ZodNumber, number, number>;
        quantityMaintenance: z.ZodEffects<z.ZodNumber, number, number>;
    }, "strict", z.ZodTypeAny, {
        itemSizeId: string;
        quantityInspection: number;
        quantityMaintenance: number;
    }, {
        itemSizeId: string;
        quantityInspection: number;
        quantityMaintenance: number;
    }>, "many">;
    subject: z.ZodOptional<z.ZodString>;
    officialReport: z.ZodOptional<z.ZodBoolean>;
    dailyReport: z.ZodOptional<z.ZodEffects<z.ZodString, Date, string>>;
    officialReportDelivery: z.ZodOptional<z.ZodEffects<z.ZodString, Date, string>>;
    dailyReportDelivery: z.ZodOptional<z.ZodEffects<z.ZodString, Date, string>>;
    poNumber: z.ZodOptional<z.ZodString>;
    poDate: z.ZodOptional<z.ZodEffects<z.ZodString, Date, string>>;
    quotationId: z.ZodString;
    startDate: z.ZodEffects<z.ZodString, Date, string>;
    endDate: z.ZodEffects<z.ZodString, Date, string>;
}, "strict", z.ZodTypeAny, {
    items: {
        itemSizeId: string;
        quantityInspection: number;
        quantityMaintenance: number;
    }[];
    startDate: Date;
    endDate: Date;
    inspectors: string[];
    quotationId: string;
    subject?: string | undefined;
    officialReport?: boolean | undefined;
    dailyReport?: Date | undefined;
    officialReportDelivery?: Date | undefined;
    dailyReportDelivery?: Date | undefined;
    poNumber?: string | undefined;
    poDate?: Date | undefined;
}, {
    items: {
        itemSizeId: string;
        quantityInspection: number;
        quantityMaintenance: number;
    }[];
    startDate: string;
    endDate: string;
    inspectors: string[];
    quotationId: string;
    subject?: string | undefined;
    officialReport?: boolean | undefined;
    dailyReport?: string | undefined;
    officialReportDelivery?: string | undefined;
    dailyReportDelivery?: string | undefined;
    poNumber?: string | undefined;
    poDate?: string | undefined;
}>;
export declare const updateWorkOrderSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    endDate: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodEffects<z.ZodString, Date, string>>>>;
    status: z.ZodOptional<z.ZodOptional<z.ZodEffects<z.ZodNativeEnum<{
        DRAFT: "DRAFT";
        IN_PROGRESS: "IN_PROGRESS";
        COMPLETED: "COMPLETED";
        CANCELED: "CANCELED";
    }>, "DRAFT" | "COMPLETED" | "CANCELED", "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "CANCELED">>>;
    contractId: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    quotationId: z.ZodOptional<z.ZodOptional<z.ZodNullable<z.ZodString>>>;
    startDate: z.ZodOptional<z.ZodEffects<z.ZodString, Date, string>>;
    inspectors: z.ZodOptional<z.ZodOptional<z.ZodEffects<z.ZodArray<z.ZodString, "many">, string[], string[]>>>;
} & {
    version: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    version: number;
    status?: "DRAFT" | "COMPLETED" | "CANCELED" | undefined;
    contractId?: string | null | undefined;
    startDate?: Date | undefined;
    endDate?: Date | null | undefined;
    inspectors?: string[] | undefined;
    quotationId?: string | null | undefined;
}, {
    version: number;
    status?: "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "CANCELED" | undefined;
    contractId?: string | null | undefined;
    startDate?: string | undefined;
    endDate?: string | null | undefined;
    inspectors?: string[] | undefined;
    quotationId?: string | null | undefined;
}>, {
    version: number;
    status?: "DRAFT" | "COMPLETED" | "CANCELED" | undefined;
    contractId?: string | null | undefined;
    startDate?: Date | undefined;
    endDate?: Date | null | undefined;
    inspectors?: string[] | undefined;
    quotationId?: string | null | undefined;
}, {
    version: number;
    status?: "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "CANCELED" | undefined;
    contractId?: string | null | undefined;
    startDate?: string | undefined;
    endDate?: string | null | undefined;
    inspectors?: string[] | undefined;
    quotationId?: string | null | undefined;
}>, {
    version: number;
    status?: "DRAFT" | "COMPLETED" | "CANCELED" | undefined;
    contractId?: string | null | undefined;
    startDate?: Date | undefined;
    endDate?: Date | null | undefined;
    inspectors?: string[] | undefined;
    quotationId?: string | null | undefined;
}, {
    version: number;
    status?: "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "CANCELED" | undefined;
    contractId?: string | null | undefined;
    startDate?: string | undefined;
    endDate?: string | null | undefined;
    inspectors?: string[] | undefined;
    quotationId?: string | null | undefined;
}>;
export declare const deleteWorkOrderSchema: z.ZodObject<{
    version: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    version: number;
}, {
    version: number;
}>;
export declare const startWorkOrderSchema: z.ZodObject<{
    version: z.ZodNumber;
}, "strict", z.ZodTypeAny, {
    version: number;
}, {
    version: number;
}>;
export declare const workOrderIdSchema: z.ZodString;
export declare const listWorkOrderSchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
    status: z.ZodOptional<z.ZodNativeEnum<{
        DRAFT: "DRAFT";
        IN_PROGRESS: "IN_PROGRESS";
        COMPLETED: "COMPLETED";
        CANCELED: "CANCELED";
    }>>;
    quotationId: z.ZodOptional<z.ZodString>;
    contractId: z.ZodOptional<z.ZodString>;
    revoked: z.ZodDefault<z.ZodEffects<z.ZodEnum<["true", "false"]>, boolean, "true" | "false">>;
    search: z.ZodOptional<z.ZodString>;
}, "strict", z.ZodTypeAny, {
    revoked: boolean;
    page: number;
    limit: number;
    status?: "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "CANCELED" | undefined;
    contractId?: string | undefined;
    quotationId?: string | undefined;
    search?: string | undefined;
}, {
    status?: "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "CANCELED" | undefined;
    revoked?: "true" | "false" | undefined;
    contractId?: string | undefined;
    quotationId?: string | undefined;
    page?: number | undefined;
    limit?: number | undefined;
    search?: string | undefined;
}>;
export type CreateWorkOrderByCompanyInput = z.infer<typeof createWorkOrderByCompanySchema>;
export type CreateWorkOrderByQuotationInput = z.infer<typeof createWorkOrderByQuotationSchema>;
export type CreateWorkOrderInput = CreateWorkOrderByCompanyInput | CreateWorkOrderByQuotationInput;
export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>;
export declare const workOrderHistorySchema: z.ZodObject<Pick<{
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
    status: z.ZodOptional<z.ZodNativeEnum<{
        DRAFT: "DRAFT";
        IN_PROGRESS: "IN_PROGRESS";
        COMPLETED: "COMPLETED";
        CANCELED: "CANCELED";
    }>>;
    quotationId: z.ZodOptional<z.ZodString>;
    contractId: z.ZodOptional<z.ZodString>;
    revoked: z.ZodDefault<z.ZodEffects<z.ZodEnum<["true", "false"]>, boolean, "true" | "false">>;
    search: z.ZodOptional<z.ZodString>;
}, "page" | "limit">, "strict", z.ZodTypeAny, {
    page: number;
    limit: number;
}, {
    page?: number | undefined;
    limit?: number | undefined;
}>;
