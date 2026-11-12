import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Actor } from '../../middlewares/actor.middleware.js';
import { QuotationSnapshot, ContractSnapshot, ItemSizeReference, CompanySnapshot } from '../../integrations/gateway.js';
import { CreateWorkOrderByCompanyInput, CreateWorkOrderByQuotationInput, UpdateWorkOrderInput, listWorkOrderSchema } from './work-order.schemas.js';
declare const include: {
    inspectors: {
        orderBy: {
            position: "asc";
        };
    };
    items: boolean;
};
type WorkOrderSnapshot = Prisma.WorkOrderGetPayload<{
    include: typeof include;
}>;
export declare const workOrderRepository: {
    history(id: string, page: number, limit: number, actor: Actor): Promise<{
        history: {
            actionLabel: string;
            changedBy: {
                id: string;
                name: string;
            };
            changedAt: Date;
            id: string;
            version: number;
            createdAt: Date;
            action: string;
            createdById: string;
            createdByName: string;
            beforeSnapshot: Prisma.JsonValue | null;
            snapshot: Prisma.JsonValue;
            changes: Prisma.JsonValue;
            workOrderId: string;
        }[];
        pagination: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
    }>;
    /**
     * Company basis (POST /work-orders). The company was validated live against
     * Marketing before this call, so the stored companyId is an existing,
     * non-revoked company of the branch. A contract may still be attached; it is
     * validated against Marketing as well.
     */
    createByCompany(input: CreateWorkOrderByCompanyInput, company: CompanySnapshot, actor: Actor, contract: ContractSnapshot | null, itemReferences?: Array<CreateWorkOrderByCompanyInput["items"][number] & {
        snapshot: ItemSizeReference;
    }>): Promise<{
        items: {
            id: string;
            itemSizeId: string;
            quantityInspection: Prisma.Decimal;
            quantityMaintenance: Prisma.Decimal;
            workOrderId: string;
            item: Prisma.JsonValue;
        }[];
        inspectors: {
            name: string;
            id: string;
            position: number;
            workOrderId: string;
        }[];
    } & {
        number: string;
        officeBranchId: string;
        status: import(".prisma/client").$Enums.WorkOrderStatus;
        date: Date;
        id: string;
        version: number;
        subject: string;
        createdAt: Date;
        updatedAt: Date;
        revoked: boolean;
        companyId: string;
        createdById: string;
        createdByName: string;
        contractId: string | null;
        startDate: Date;
        endDate: Date | null;
        officialReport: boolean;
        dailyReport: Date;
        officialReportDelivery: Date;
        dailyReportDelivery: Date;
        poNumber: string;
        poDate: Date;
        quotationId: string | null;
        contractSnapshot: Prisma.JsonValue | null;
        quotationSnapshot: Prisma.JsonValue | null;
        updatedById: string | null;
        updatedByName: string | null;
    }>;
    /**
     * Quotation basis (POST /work-orders/from-quotation). The quotation was
     * validated live against Marketing before this call, so the stored quotation
     * snapshot matches the approved document and the companyId is the company of
     * that quotation.
     *
     * Marketing is notified of the new link before the transaction commits, so
     * the quotation records the Work Order reference together with the Work
     * Order itself. A failed notification aborts the transaction and no Work
     * Order is created, which keeps both services consistent.
     */
    createByQuotation(input: CreateWorkOrderByQuotationInput, quotation: QuotationSnapshot, actor: Actor, beforeCommit?: (workOrder: WorkOrderSnapshot) => Promise<void>): Promise<{
        items: {
            id: string;
            itemSizeId: string;
            quantityInspection: Prisma.Decimal;
            quantityMaintenance: Prisma.Decimal;
            workOrderId: string;
            item: Prisma.JsonValue;
        }[];
        inspectors: {
            name: string;
            id: string;
            position: number;
            workOrderId: string;
        }[];
    } & {
        number: string;
        officeBranchId: string;
        status: import(".prisma/client").$Enums.WorkOrderStatus;
        date: Date;
        id: string;
        version: number;
        subject: string;
        createdAt: Date;
        updatedAt: Date;
        revoked: boolean;
        companyId: string;
        createdById: string;
        createdByName: string;
        contractId: string | null;
        startDate: Date;
        endDate: Date | null;
        officialReport: boolean;
        dailyReport: Date;
        officialReportDelivery: Date;
        dailyReportDelivery: Date;
        poNumber: string;
        poDate: Date;
        quotationId: string | null;
        contractSnapshot: Prisma.JsonValue | null;
        quotationSnapshot: Prisma.JsonValue | null;
        updatedById: string | null;
        updatedByName: string | null;
    }>;
    list(input: z.infer<typeof listWorkOrderSchema>, actor: Actor): Promise<{
        workOrders: {
            quotationNo: number | null;
            quotationDate: string | null;
            contractNumber: string | null;
            contractDate: string | null;
            companyId: string;
            company: string | null;
            subject: string;
            officialReport: boolean;
            dailyReport: string;
            officialReportDelivery: string;
            dailyReportDelivery: string;
            poNumber: string;
            poDate: string;
            date: string;
            startDate: string;
            endDate: string | null;
            number: string;
            officeBranchId: string;
            status: import(".prisma/client").$Enums.WorkOrderStatus;
            id: string;
            version: number;
            createdAt: Date;
            updatedAt: Date;
            revoked: boolean;
            createdById: string;
            createdByName: string;
            contractId: string | null;
            quotationId: string | null;
            updatedById: string | null;
            updatedByName: string | null;
        }[];
        pagination: {
            page: number;
            limit: number;
            total: number;
            totalPages: number;
        };
    }>;
    findActiveByQuotation(quotationId: string, actor: Actor): Promise<{
        number: string;
        officeBranchId: string;
        status: import(".prisma/client").$Enums.WorkOrderStatus;
        id: string;
        version: number;
        revoked: boolean;
        contractId: string | null;
        quotationId: string | null;
        quotationSnapshot: Prisma.JsonValue;
    } | null>;
    get(id: string, actor: Actor): Promise<{
        items: {
            id: string;
            itemSizeId: string;
            quantityInspection: Prisma.Decimal;
            quantityMaintenance: Prisma.Decimal;
            workOrderId: string;
            item: Prisma.JsonValue;
        }[];
        inspectors: {
            name: string;
            id: string;
            position: number;
            workOrderId: string;
        }[];
    } & {
        number: string;
        officeBranchId: string;
        status: import(".prisma/client").$Enums.WorkOrderStatus;
        date: Date;
        id: string;
        version: number;
        subject: string;
        createdAt: Date;
        updatedAt: Date;
        revoked: boolean;
        companyId: string;
        createdById: string;
        createdByName: string;
        contractId: string | null;
        startDate: Date;
        endDate: Date | null;
        officialReport: boolean;
        dailyReport: Date;
        officialReportDelivery: Date;
        dailyReportDelivery: Date;
        poNumber: string;
        poDate: Date;
        quotationId: string | null;
        contractSnapshot: Prisma.JsonValue | null;
        quotationSnapshot: Prisma.JsonValue | null;
        updatedById: string | null;
        updatedByName: string | null;
    }>;
    update(id: string, input: UpdateWorkOrderInput, quote: QuotationSnapshot | ContractSnapshot | null, actor: Actor, beforeCommit?: (workOrder: WorkOrderSnapshot) => Promise<void>): Promise<{
        items: {
            id: string;
            itemSizeId: string;
            quantityInspection: Prisma.Decimal;
            quantityMaintenance: Prisma.Decimal;
            workOrderId: string;
            item: Prisma.JsonValue;
        }[];
        inspectors: {
            name: string;
            id: string;
            position: number;
            workOrderId: string;
        }[];
    } & {
        number: string;
        officeBranchId: string;
        status: import(".prisma/client").$Enums.WorkOrderStatus;
        date: Date;
        id: string;
        version: number;
        subject: string;
        createdAt: Date;
        updatedAt: Date;
        revoked: boolean;
        companyId: string;
        createdById: string;
        createdByName: string;
        contractId: string | null;
        startDate: Date;
        endDate: Date | null;
        officialReport: boolean;
        dailyReport: Date;
        officialReportDelivery: Date;
        dailyReportDelivery: Date;
        poNumber: string;
        poDate: Date;
        quotationId: string | null;
        contractSnapshot: Prisma.JsonValue | null;
        quotationSnapshot: Prisma.JsonValue | null;
        updatedById: string | null;
        updatedByName: string | null;
    }>;
    /**
     * DRAFT -> IN_PROGRESS. For quotation-based orders the stored snapshot is
     * compared against the live Marketing quotation (validated by the route before
     * the transaction starts), so an upstream call never holds database locks.
     * Contract/company-based orders transition without quotation validation.
     * The claim itself is an optimistic updateMany on status/version/revoked, so
     * concurrent starters cannot both succeed.
     */
    start(id: string, version: number, quote: QuotationSnapshot | null, actor: Actor, beforeCommit?: (workOrder: WorkOrderSnapshot) => Promise<void>): Promise<{
        items: {
            id: string;
            itemSizeId: string;
            quantityInspection: Prisma.Decimal;
            quantityMaintenance: Prisma.Decimal;
            workOrderId: string;
            item: Prisma.JsonValue;
        }[];
        inspectors: {
            name: string;
            id: string;
            position: number;
            workOrderId: string;
        }[];
    } & {
        number: string;
        officeBranchId: string;
        status: import(".prisma/client").$Enums.WorkOrderStatus;
        date: Date;
        id: string;
        version: number;
        subject: string;
        createdAt: Date;
        updatedAt: Date;
        revoked: boolean;
        companyId: string;
        createdById: string;
        createdByName: string;
        contractId: string | null;
        startDate: Date;
        endDate: Date | null;
        officialReport: boolean;
        dailyReport: Date;
        officialReportDelivery: Date;
        dailyReportDelivery: Date;
        poNumber: string;
        poDate: Date;
        quotationId: string | null;
        contractSnapshot: Prisma.JsonValue | null;
        quotationSnapshot: Prisma.JsonValue | null;
        updatedById: string | null;
        updatedByName: string | null;
    }>;
    revoke(id: string, version: number, actor: Actor, beforeCommit?: (workOrder: WorkOrderSnapshot) => Promise<void>): Promise<{
        items: {
            id: string;
            itemSizeId: string;
            quantityInspection: Prisma.Decimal;
            quantityMaintenance: Prisma.Decimal;
            workOrderId: string;
            item: Prisma.JsonValue;
        }[];
        inspectors: {
            name: string;
            id: string;
            position: number;
            workOrderId: string;
        }[];
    } & {
        number: string;
        officeBranchId: string;
        status: import(".prisma/client").$Enums.WorkOrderStatus;
        date: Date;
        id: string;
        version: number;
        subject: string;
        createdAt: Date;
        updatedAt: Date;
        revoked: boolean;
        companyId: string;
        createdById: string;
        createdByName: string;
        contractId: string | null;
        startDate: Date;
        endDate: Date | null;
        officialReport: boolean;
        dailyReport: Date;
        officialReportDelivery: Date;
        dailyReportDelivery: Date;
        poNumber: string;
        poDate: Date;
        quotationId: string | null;
        contractSnapshot: Prisma.JsonValue | null;
        quotationSnapshot: Prisma.JsonValue | null;
        updatedById: string | null;
        updatedByName: string | null;
    }>;
};
export {};
