import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingCalculatorService } from './billing-calculator.service';
import { BillingRulesService } from '../billing-rules/billing-rules.service';
import { CreateBillingPeriodDto } from './dto/create-billing-period.dto';
import { Prisma, BillingPeriodStatus } from '@prisma/client';
import { generateInvoiceNumber } from '../common/utils/invoice-number';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: BillingCalculatorService,
    private readonly billingRulesService: BillingRulesService,
  ) {}

  async createPeriod(societyId: string, dto: CreateBillingPeriodDto) {
    const existing = await this.prisma.billingPeriod.findFirst({
      where: { societyId, periodYear: dto.periodYear, periodMonth: dto.periodMonth },
    });
    if (existing) throw new BadRequestException('Billing period already exists for this month');

    return this.prisma.billingPeriod.create({
      data: {
        societyId,
        periodYear: dto.periodYear,
        periodMonth: dto.periodMonth,
        startDate: new Date(dto.startDate),
        endDate: new Date(dto.endDate),
        dueDate: new Date(dto.dueDate),
        status: BillingPeriodStatus.DRAFT,
        notes: dto.notes,
      },
    });
  }

  async generateBills(societyId: string, periodId: string, generatedById: string) {
    const period = await this.findPeriod(societyId, periodId);

    if (!['DRAFT', 'CALCULATED'].includes(period.status)) {
      throw new BadRequestException('Bills can only be generated for DRAFT or CALCULATED periods');
    }

    const config = await this.prisma.societyConfiguration.findUnique({ where: { societyId } });
    if (!config) throw new BadRequestException('Society configuration not found');

    // Get active billing rules
    const rules = await this.billingRulesService.findActive(societyId, period.startDate);

    // Get all active flats
    const flats = await this.prisma.flat.findMany({
      where: { societyId, isActive: true, deletedAt: null, status: 'ACTIVE' },
      include: {
        memberships: { where: { status: 'ACTIVE' } },
      },
    });

    const result = await this.prisma.$transaction(async (tx) => {
      // Delete existing draft bills for this period
      await tx.billLineItem.deleteMany({
        where: { maintenanceBill: { billingPeriodId: periodId, societyId } },
      });
      await tx.maintenanceBill.deleteMany({
        where: { billingPeriodId: periodId, societyId },
      });

      // Build flat → total water charge map from any readings recorded for this period
      const waterReadings = await tx.waterMeterReading.findMany({
        where: { societyId, billingPeriodId: periodId },
        select: { flatId: true, calculatedAmount: true },
      });
      const waterChargesMap = new Map<string, number>();
      for (const r of waterReadings) {
        const prev = waterChargesMap.get(r.flatId) ?? 0;
        waterChargesMap.set(r.flatId, prev + (r.calculatedAmount?.toNumber() ?? 0));
      }

      let invoiceNumber = config.invoiceCurrentNumber;
      const bills = [];

      for (const flat of flats) {
        const flatCtx = {
          flatId: flat.id,
          flatCode: flat.flatCode,
          area: flat.area,
          category: flat.category,
          parkingSlots: flat.parkingSlots,
          residentCount: flat.memberships.filter((m) => m.role === 'RESIDENT').length,
          buildingId: flat.buildingId,
        };

        const billResult = this.calculator.calculateFlatBill(flatCtx, rules);
        const waterCharge = waterChargesMap.get(flat.id) ?? 0;
        const grandTotal = billResult.baseAmount + waterCharge;
        const invNumber = generateInvoiceNumber(config.invoicePrefix, invoiceNumber++);

        const calculationSnapshot = {
          rules: rules.map((r) => ({
            id: r.id,
            name: r.name,
            type: r.calculationType,
            config: r.config,
            components: r.components.map((c) => ({
              id: c.id,
              name: c.name,
              type: c.componentType,
              calculationType: c.calculationType,
              amount: c.amount?.toNumber() ?? null,
              rate: c.rate?.toNumber() ?? null,
              config: c.config,
            })),
          })),
          lineItems: billResult.lineItems.map((li) => ({
            componentName: li.componentName,
            componentType: li.componentType,
            quantity: li.quantity,
            rate: li.rate,
            amount: li.amount,
            calculationNote: li.calculationNote,
          })),
          flatArea: flat.area?.toNumber(),
          residentCount: flatCtx.residentCount,
          waterCharge,
          generatedAt: new Date().toISOString(),
          generatedBy: generatedById,
        };

        const waterLineItem = waterCharge > 0
          ? [{
              componentName: 'Water Charges',
              componentType: 'WATER',
              description: 'Water meter reading charge for billing period',
              amount: new Prisma.Decimal(waterCharge),
              calculationNote: `Water usage: ₹${waterCharge.toFixed(2)}`,
            }]
          : [];

        const bill = await tx.maintenanceBill.create({
          data: {
            societyId,
            billingPeriodId: periodId,
            flatId: flat.id,
            invoiceNumber: invNumber,
            flatCode: flat.flatCode,
            flatArea: flat.area,
            flatCategory: flat.category,
            residentCount: flatCtx.residentCount,
            baseAmount: new Prisma.Decimal(billResult.baseAmount),
            waterCharges: new Prisma.Decimal(waterCharge),
            totalAmount: new Prisma.Decimal(grandTotal),
            pendingAmount: new Prisma.Decimal(grandTotal),
            dueDate: period.dueDate,
            calculationSnapshot: calculationSnapshot as Prisma.InputJsonValue,
            lineItems: {
              create: [
                ...billResult.lineItems.map((li) => ({
                  billingRuleId: li.billingRuleId,
                  componentName: li.componentName,
                  componentType: li.componentType,
                  description: li.description,
                  quantity: li.quantity ? new Prisma.Decimal(li.quantity) : undefined,
                  rate: li.rate ? new Prisma.Decimal(li.rate) : undefined,
                  amount: new Prisma.Decimal(li.amount),
                  calculationNote: li.calculationNote,
                })),
                ...waterLineItem,
              ],
            },
          },
        });

        bills.push(bill);
      }

      // Update invoice counter
      await tx.societyConfiguration.update({
        where: { societyId },
        data: { invoiceCurrentNumber: invoiceNumber },
      });

      const totalBilled = bills.reduce(
        (sum, b) => sum + b.totalAmount.toNumber(),
        0,
      );

      await tx.billingPeriod.update({
        where: { id: periodId },
        data: {
          status: BillingPeriodStatus.CALCULATED,
          totalBilled: new Prisma.Decimal(totalBilled),
          totalPending: new Prisma.Decimal(totalBilled),
          totalCollected: new Prisma.Decimal(0),
        },
      });

      return { billsGenerated: bills.length, totalBilled };
    });

    return result;
  }

  async publishPeriod(societyId: string, periodId: string, publishedById: string) {
    const period = await this.findPeriod(societyId, periodId);

    if (period.status !== BillingPeriodStatus.REVIEW && period.status !== BillingPeriodStatus.CALCULATED) {
      throw new BadRequestException('Period must be in CALCULATED or REVIEW status to publish');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.maintenanceBill.updateMany({
        where: { billingPeriodId: periodId, societyId },
        data: { isPublished: true },
      });

      return tx.billingPeriod.update({
        where: { id: periodId },
        data: {
          status: BillingPeriodStatus.PUBLISHED,
          publishedAt: new Date(),
          publishedById,
        },
      });
    });
  }

  async closePeriod(societyId: string, periodId: string, closedById: string) {
    const period = await this.findPeriod(societyId, periodId);

    const allowed: BillingPeriodStatus[] = [
      BillingPeriodStatus.PUBLISHED,
      BillingPeriodStatus.PARTIALLY_PAID,
      BillingPeriodStatus.PAID,
    ];

    if (!allowed.includes(period.status)) {
      throw new BadRequestException('Period must be PUBLISHED, PARTIALLY_PAID, or PAID to close');
    }

    return this.prisma.billingPeriod.update({
      where: { id: periodId },
      data: {
        status: BillingPeriodStatus.CLOSED,
        closedAt: new Date(),
        closedById,
      },
    });
  }

  async findPeriods(societyId: string, page: number, limit: number) {
    const { skip, take } = getPaginationParams({ page, limit });
    const [data, total] = await Promise.all([
      this.prisma.billingPeriod.findMany({
        skip,
        take,
        where: { societyId },
        orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
      }),
      this.prisma.billingPeriod.count({ where: { societyId } }),
    ]);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findPeriod(societyId: string, periodId: string) {
    const period = await this.prisma.billingPeriod.findFirst({
      where: { id: periodId, societyId },
    });
    if (!period) throw new NotFoundException('Billing period not found');
    return period;
  }

  async findBillsByPeriod(societyId: string, periodId: string, page: number, limit: number) {
    await this.findPeriod(societyId, periodId);
    const { skip, take } = getPaginationParams({ page, limit });
    const [data, total] = await Promise.all([
      this.prisma.maintenanceBill.findMany({
        skip,
        take,
        where: { societyId, billingPeriodId: periodId },
        include: { flat: { select: { id: true, flatCode: true } } },
        orderBy: { flatCode: 'asc' },
      }),
      this.prisma.maintenanceBill.count({ where: { societyId, billingPeriodId: periodId } }),
    ]);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findMyBills(societyId: string, flatId: string, page: number, limit: number) {
    const { skip, take } = getPaginationParams({ page, limit });
    const [data, total] = await Promise.all([
      this.prisma.maintenanceBill.findMany({
        skip,
        take,
        where: { societyId, flatId, isPublished: true },
        include: {
          lineItems: true,
          billingPeriod: { select: { id: true, periodYear: true, periodMonth: true } },
        },
        orderBy: [{ billingPeriod: { periodYear: 'desc' } }, { billingPeriod: { periodMonth: 'desc' } }],
      }),
      this.prisma.maintenanceBill.count({ where: { societyId, flatId, isPublished: true } }),
    ]);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findBillById(societyId: string, billId: string, flatId?: string) {
    const where: Prisma.MaintenanceBillWhereInput = { id: billId, societyId };
    if (flatId) {
      where.flatId = flatId;
      where.isPublished = true;
    }

    const bill = await this.prisma.maintenanceBill.findFirst({
      where,
      include: {
        lineItems: true,
        billingPeriod: true,
        flat: { select: { id: true, flatCode: true } },
        paymentSubmissions: {
          where: { status: { in: ['APPROVED', 'PENDING', 'UNDER_REVIEW'] } },
        },
      },
    });
    if (!bill) throw new NotFoundException('Bill not found');
    return bill;
  }

  async adjustBill(
    societyId: string,
    billId: string,
    adjustment: number,
    note: string,
  ) {
    const bill = await this.findBillById(societyId, billId);
    const period = await this.findPeriod(societyId, bill.billingPeriodId);

    if (['CLOSED', 'PUBLISHED', 'PAID'].includes(period.status)) {
      throw new ForbiddenException('Cannot adjust bills in CLOSED, PUBLISHED, or PAID periods');
    }

    const newTotal = bill.totalAmount.toNumber() + adjustment;
    return this.prisma.maintenanceBill.update({
      where: { id: billId },
      data: {
        adjustments: { increment: adjustment },
        totalAmount: new Prisma.Decimal(newTotal),
        pendingAmount: new Prisma.Decimal(Math.max(0, newTotal - bill.paidAmount.toNumber())),
        notes: note,
      },
    });
  }
}
