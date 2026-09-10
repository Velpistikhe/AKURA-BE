import { Prisma } from '@prisma/client';
import { prisma } from '../../config/db.js';
import { AuditActor } from '../../types/auth.types.js';
import { HttpError } from '../../utils/httpError.js';
import { createQuotationSchema, updateQuotationSchema, deactivateQuotationSchema, QuotationItemInput } from './quotation.schemas.js';

const include = { items: { orderBy: { position: 'asc' as const } } };
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const amount = (value: Prisma.Decimal) => {
  const rounded = value.toDecimalPlaces(2);
  if (rounded.greaterThan('9999999999999999.99')) throw new HttpError('Quotation amount exceeds supported precision', 400);
  return rounded;
};

async function customer(tx: Prisma.TransactionClient, staffId: string, officeBranchId: string) {
  const staff = await tx.companyStaff.findFirst({
    where: { id: staffId, revoked: false, company: { officeBranchId, revoked: false } },
    include: { company: true },
  });
  if (!staff) throw new HttpError('Company staff not found or inactive', 404);
  return json(staff);
}

async function newItem(tx: Prisma.TransactionClient, input: QuotationItemInput, officeBranchId: string, actor: AuditActor, position: number) {
  const size = await tx.itemSize.findFirst({
    where: { id: input.itemSizeId, isActive: true, item: { officeBranchId, isActive: true, service: { officeBranchId, isActive: true } } },
    include: { item: { include: { service: true } } },
  });
  if (!size) throw new HttpError('Item size not found or inactive', 404);
  const quantity = new Prisma.Decimal(input.quantity);
  const unitPrice = new Prisma.Decimal(input.unitPrice);
  return {
    itemSizeId: size.id, position, serviceName: size.item.service.name,
    serviceType: size.item.service.type, itemName: size.item.name, size: size.size,
    quantity, unitPrice, subTotal: amount(quantity.mul(unitPrice)), createdById: actor.id,
  };
}

async function saveRevision(tx: Prisma.TransactionClient, id: string, actor: AuditActor, action: string) {
  const quote = await tx.quotation.findUniqueOrThrow({ where: { id }, include });
  await tx.quotationHistory.create({ data: {
    quotationId: id, version: quote.version, action, snapshot: json(quote), createdById: actor.id,
  } });
  return quote;
}

async function totals(tx: Prisma.TransactionClient, id: string, tax: number) {
  const rows = await tx.quotationItem.findMany({ where: { quotationId: id, isActive: true } });
  const subTotal = amount(rows.reduce((sum, row) => sum.add(row.subTotal), new Prisma.Decimal(0)));
  const taxAmount = amount(subTotal.mul(tax).div(100));
  return { subTotal, taxAmount, total: amount(subTotal.add(taxAmount)) };
}

// All header/item writes go through this aggregate. Never update items independently.
export const quotationRepository = {
  async create(input: unknown, officeBranchId: string, actor: AuditActor) {
    const { items, ...data } = createQuotationSchema.parse(input);
    return prisma.$transaction(async (tx) => {
      const customerSnapshot = await customer(tx, data.staffId, officeBranchId);
      const quote = await tx.quotation.create({ data: { ...data, officeBranchId, customerSnapshot, createdById: actor.id } });
      for (const [position, item] of items.entries()) {
        await tx.quotationItem.create({ data: { ...await newItem(tx, item, officeBranchId, actor, position), quotationId: quote.id } });
      }
      await tx.quotation.update({ where: { id: quote.id }, data: await totals(tx, quote.id, quote.tax) });
      return saveRevision(tx, quote.id, actor, 'CREATE');
    });
  },

  async update(id: string, input: unknown, officeBranchId: string, actor: AuditActor) {
    const { version, items, ...data } = updateQuotationSchema.parse(input);
    return prisma.$transaction(async (tx) => {
      // Atomic compare-and-swap locks the row before touching any children.
      const claimed = await tx.quotation.updateMany({
        where: { id, officeBranchId, version, isActive: true },
        data: { version: { increment: 1 }, updatedById: actor.id },
      });
      if (!claimed.count) {
        if (!await tx.quotation.findFirst({ where: { id, officeBranchId } })) throw new HttpError('Quotation not found', 404);
        throw new HttpError('Quotation has changed or is inactive; reload before retrying', 409);
      }
      const current = await tx.quotation.findUniqueOrThrow({ where: { id }, include });
      const customerSnapshot = data.staffId && data.staffId !== current.staffId ? await customer(tx, data.staffId, officeBranchId) : undefined;
      if (items) {
        const retained = items.flatMap((item) => item.id ? [item.id] : []);
        await tx.quotationItem.updateMany({
          where: { quotationId: id, isActive: true, id: { notIn: retained } },
          data: { isActive: false, updatedById: actor.id },
        });
        for (const [position, item] of items.entries()) {
          if (item.id) {
            const previous = current.items.find((row) => row.id === item.id && row.isActive);
            if (!previous) throw new HttpError('Quotation item not found', 404);
            if (previous.itemSizeId !== item.itemSizeId) throw new HttpError('Replace the item with a new line to change its catalog reference', 400);
            const quantity = new Prisma.Decimal(item.quantity);
            const unitPrice = new Prisma.Decimal(item.unitPrice);
            await tx.quotationItem.update({ where: { id: item.id }, data: {
              position, quantity, unitPrice, subTotal: amount(quantity.mul(unitPrice)), updatedById: actor.id,
            } });
          } else {
            await tx.quotationItem.create({ data: { ...await newItem(tx, item, officeBranchId, actor, position), quotationId: id } });
          }
        }
      }
      await tx.quotation.update({ where: { id }, data: { ...data, customerSnapshot, ...await totals(tx, id, data.tax ?? current.tax) } });
      return saveRevision(tx, id, actor, 'UPDATE');
    });
  },

  async deactivate(id: string, input: unknown, officeBranchId: string, actor: AuditActor) {
    const { version } = deactivateQuotationSchema.parse(input);
    return prisma.$transaction(async (tx) => {
      const claimed = await tx.quotation.updateMany({
        where: { id, officeBranchId, version, isActive: true },
        data: { isActive: false, version: { increment: 1 }, updatedById: actor.id },
      });
      if (!claimed.count) {
        if (!await tx.quotation.findFirst({ where: { id, officeBranchId } })) throw new HttpError('Quotation not found', 404);
        throw new HttpError('Quotation has changed or is inactive; reload before retrying', 409);
      }
      await tx.quotationItem.updateMany({ where: { quotationId: id, isActive: true }, data: { isActive: false, updatedById: actor.id } });
      return saveRevision(tx, id, actor, 'DEACTIVATE');
    });
  },

  history: (id: string, officeBranchId: string) => prisma.quotationHistory.findMany({
    where: { quotationId: id, quotation: { officeBranchId } }, orderBy: { version: 'asc' },
  }),
};
