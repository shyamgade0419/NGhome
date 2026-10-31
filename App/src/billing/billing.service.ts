import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { NO_USAGE, PeriodUsage, deleteBlocker } from './billing-period-delete';
import { applyCreditToPeriod } from './advance-credit';
import { DiscountRule, discountFor } from './flat-discounts';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BillingCalculatorService } from './billing-calculator.service';
import { BillingRulesService } from '../billing-rules/billing-rules.service';
import { CreateBillingPeriodDto } from './dto/create-billing-period.dto';
import { Prisma, BillingPeriodStatus, BillingPeriodKind } from '@prisma/client';
import { generateInvoiceNumber } from '../common/utils/invoice-number';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calculator: BillingCalculatorService,
    private readonly billingRulesService: BillingRulesService,
    private readonly notifications: NotificationsService,
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

    // Standing discounts in force for this period, by flat: they are taken off every bill generated, so a
    // regenerate keeps them (unlike a one-off adjustment on a single bill, which a regenerate wipes).
    const discountRows = await this.prisma.flatDiscount.findMany({
      where: {
        societyId,
        isActive: true,
        effectiveFrom: { lte: period.startDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: period.startDate } }],
      },
      orderBy: { createdAt: 'asc' },
    });
    const discountsByFlat = new Map<string, DiscountRule[]>();
    for (const row of discountRows) {
      discountsByFlat.set(row.flatId, [...(discountsByFlat.get(row.flatId) ?? []), row]);
    }

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
        const discount = discountFor(discountsByFlat.get(flat.id) ?? [], new Prisma.Decimal(billResult.baseAmount), period.startDate);
        const payable = new Prisma.Decimal(grandTotal).minus(discount.total);
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
          discount: discount.total.toString(),
          discountReasons: discount.reasons,
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

        const discountLineItem = discount.total.greaterThan(0)
          ? [{
              componentName: 'Discount',
              componentType: 'DISCOUNT',
              description: discount.reasons.join(', '),
              amount: discount.total.negated(),
              calculationNote: 'Standing discount for this flat',
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
            adjustments: discount.total.negated(),
            totalAmount: payable,
            pendingAmount: payable,
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
                ...discountLineItem,
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

    const published = await this.prisma.$transaction(async (tx) => {
      // Lock the flats that hold advance credit before touching any bill — the order a payment's
      // settlement uses too (flat, then its bills) — so the two cannot deadlock or spend a credit twice.
      await tx.$queryRaw`
        SELECT id FROM flats
        WHERE "societyId" = ${societyId} AND "creditBalance" > 0
        ORDER BY id FOR NO KEY UPDATE`; // not FOR UPDATE: see settleOldestFirst

      await tx.maintenanceBill.updateMany({
        where: { billingPeriodId: periodId, societyId },
        data: { isPublished: true },
      });

      // A flat that has paid ahead has its next bill paid from that credit as it is published.
      await applyCreditToPeriod(tx, societyId, periodId);

      return tx.billingPeriod.update({
        where: { id: periodId },
        data: {
          status: BillingPeriodStatus.PUBLISHED,
          publishedAt: new Date(),
          publishedById,
        },
      });
    });

    // Publishing is the moment bills become visible, and until now nothing
    // told anyone. Residents had to open the app on the off-chance. Sent
    // outside the transaction and best-effort — a failed notification must
    // not roll back a period that is already published.
    const periodLabel = new Date(published.periodYear, published.periodMonth - 1, 1)
      .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const dueLabel = published.dueDate.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'long',
    });

    await this.notifications.notifyQuietly(
      () =>
        this.notifications.send(societyId, {
          title: `${periodLabel} bill is ready`,
          body: `Your maintenance bill for ${periodLabel} is now available. Due ${dueLabel}.`,
          type: 'BILL_PUBLISHED',
          data: { billingPeriodId: periodId },
        }),
      `billing period ${periodId} published`,
    );

    return published;
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

  /** Returns published periods only — used by the resident-accessible statement page. */
  async listPublishedPeriods(societyId: string) {
    return this.prisma.billingPeriod.findMany({
      where: {
        societyId,
        // Not the opening period: it is dues carried over, not a month with a statement of its own.
        kind: BillingPeriodKind.REGULAR,
        status: { in: ['PUBLISHED', 'PARTIALLY_PAID', 'PAID', 'CLOSED'] },
      },
      select: {
        id: true,
        periodYear: true,
        periodMonth: true,
        status: true,
        dueDate: true,
        totalBilled: true,
        totalCollected: true,
        totalPending: true,
      },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
      take: 24,
    });
  }

  async findPeriods(societyId: string, page: number, limit: number) {
    const { skip, take } = getPaginationParams({ page, limit });
    const [periods, total] = await Promise.all([
      this.prisma.billingPeriod.findMany({
        skip,
        take,
        where: { societyId, kind: BillingPeriodKind.REGULAR },
        orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
      }),
      this.prisma.billingPeriod.count({ where: { societyId, kind: BillingPeriodKind.REGULAR } }),
    ]);

    // Each period says whether it can be deleted, so the screen shows the option only where it works.
    const usage = await this.periodUsage(societyId, periods.map((p) => p.id));
    const data = periods.map((p) => ({ ...p, canDelete: deleteBlocker(p.status, usage.get(p.id) ?? NO_USAGE) === null }));
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  /** What each period holds. Payments and water readings carry only the period's id, with no database link to it. */
  private async periodUsage(societyId: string, periodIds: string[]): Promise<Map<string, PeriodUsage>> {
    const usage = new Map<string, PeriodUsage>(periodIds.map((id) => [id, { ...NO_USAGE }]));
    if (periodIds.length === 0) return usage;
    const where = { societyId, billingPeriodId: { in: periodIds } };
    const [bills, payments, readings, statements] = await Promise.all([
      this.prisma.maintenanceBill.groupBy({ by: ['billingPeriodId'], where, _count: { _all: true } }),
      this.prisma.paymentSubmission.groupBy({ by: ['billingPeriodId'], where, _count: { _all: true } }),
      this.prisma.waterMeterReading.groupBy({ by: ['billingPeriodId'], where, _count: { _all: true } }),
      this.prisma.monthlyStatement.groupBy({ by: ['billingPeriodId'], where, _count: { _all: true } }),
    ]);
    const add = (rows: { billingPeriodId: string | null; _count: { _all: number } }[], key: keyof PeriodUsage) => {
      for (const r of rows) if (r.billingPeriodId) usage.get(r.billingPeriodId)![key] = r._count._all;
    };
    add(bills, 'bills');
    add(payments, 'payments');
    add(readings, 'waterReadings');
    add(statements, 'statements');
    return usage;
  }

  /**
   * Delete a period, only if it holds nothing. The bills and the statement are also held by the
   * database (a delete with either present is refused), so a bill generated at the same instant
   * cannot be lost; payments and water readings are checked here.
   */
  async deletePeriod(societyId: string, periodId: string, actorId: string) {
    const period = await this.findPeriod(societyId, periodId);
    const usage = (await this.periodUsage(societyId, [periodId])).get(periodId) ?? NO_USAGE;
    const blocker = deleteBlocker(period.status, usage);
    if (blocker) throw new ConflictException(blocker);

    try {
      await this.prisma.$transaction([
        this.prisma.billingPeriod.delete({ where: { id: periodId } }),
        this.prisma.auditLog.create({
          data: {
            societyId,
            actorId,
            action: 'OTHER',
            entityType: 'BillingPeriod',
            entityId: periodId,
            oldValues: { periodYear: period.periodYear, periodMonth: period.periodMonth, status: period.status } as Prisma.InputJsonValue,
          },
        }),
      ]);
    } catch (err) {
      // A bill or statement appeared between the check and the delete: the database refused.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new ConflictException('This period just received data, so it cannot be deleted.');
      }
      throw err;
    }
    return { success: true };
  }

  /** A flat's advance credit: the balance, and the latest times it was added to or used. */
  async getFlatCredit(societyId: string, flatId: string) {
    const [flat, entries] = await Promise.all([
      this.prisma.flat.findFirst({ where: { id: flatId, societyId }, select: { creditBalance: true } }),
      this.prisma.flatCreditEntry.findMany({
        where: { societyId, flatId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, amount: true, kind: true, createdAt: true },
      }),
    ]);
    return { balance: (flat?.creditBalance ?? new Prisma.Decimal(0)).toString(), entries };
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
        include: {
          flat: {
            select: {
              id: true,
              flatCode: true,
              // Include primary resident so the admin can send direct WhatsApp reminders
              memberships: {
                where: { status: 'ACTIVE', isPrimary: true, role: 'RESIDENT' },
                take: 1,
                select: {
                  user: { select: { phone: true, firstName: true, lastName: true } },
                },
              },
            },
          },
        },
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
          billingPeriod: { select: { id: true, periodYear: true, periodMonth: true, kind: true } },
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

  /**
   * Resident: preview the flat's bill for the next period once bills have
   * been generated but before the period is officially published. DRAFT
   * periods have no bills yet (nothing to return); PUBLISHED and later are
   * already visible through the normal my-bills list — this fills only the
   * CALCULATED/REVIEW gap, and only for the caller's own flat.
   */
  async previewMyBill(societyId: string, flatId: string) {
    const period = await this.prisma.billingPeriod.findFirst({
      where: { societyId, status: { in: ['CALCULATED', 'REVIEW'] } },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    });
    if (!period) return null;

    const bill = await this.prisma.maintenanceBill.findFirst({
      where: { societyId, flatId, billingPeriodId: period.id },
      include: { lineItems: true },
    });
    if (!bill) return null;

    return { ...bill, periodStatus: period.status, isPreview: true as const };
  }

  /** Returns all bills for a period with line items — for holistic report / PDF download */
  async getPeriodReport(societyId: string, periodId: string) {
    const period = await this.findPeriod(societyId, periodId);
    const bills = await this.prisma.maintenanceBill.findMany({
      where: { societyId, billingPeriodId: periodId },
      include: {
        lineItems: { orderBy: { componentName: 'asc' } },
        flat: { select: { id: true, flatCode: true, area: true, bedrooms: true } },
      },
      orderBy: { flatCode: 'asc' },
    });

    const society = await this.prisma.society.findUnique({
      where: { id: societyId },
      select: { name: true, displayName: true, address: true, city: true, state: true },
    });

    return { society, period, bills };
  }

  /**
   * Comprehensive monthly maintenance statement per flat.
   * Returns general maintenance, water readings, adjustments/discount,
   * late fees, other charges, and arrears from prior unpaid bills —
   * giving admins and residents a single-view total payable breakdown.
   */
  async getPeriodStatement(societyId: string, periodId: string) {
    const period = await this.findPeriod(societyId, periodId);

    const bills = await this.prisma.maintenanceBill.findMany({
      where: { societyId, billingPeriodId: periodId },
      include: {
        flat: {
          include: {
            memberships: {
              where: { status: 'ACTIVE', role: 'RESIDENT' },
              take: 1,
              include: {
                user: { select: { firstName: true, lastName: true, phone: true } },
              },
            },
          },
        },
      },
      orderBy: { flatCode: 'asc' },
    });

    // Water readings keyed by flatId
    const waterReadings = await this.prisma.waterMeterReading.findMany({
      where: { societyId, billingPeriodId: periodId },
    });
    const waterByFlat = new Map<string, typeof waterReadings[0]>();
    for (const r of waterReadings) {
      waterByFlat.set(r.flatId, r);
    }

    // Advance credit: what was paid ahead and used against each bill, and what each flat still holds.
    const advanceRows = await this.prisma.flatCreditEntry.groupBy({
      by: ['billId'],
      where: { societyId, kind: 'APPLIED_TO_BILL', billId: { in: bills.map((b) => b.id) } },
      _sum: { amount: true },
    });
    const advanceByBill = new Map(advanceRows.map((r) => [r.billId as string, (r._sum.amount?.toNumber() ?? 0) * -1]));

    // Arrears: sum of pendingAmount from other published-but-unpaid bills per flat
    const flatIds = bills.map((b) => b.flatId);
    const arrearsRows = await this.prisma.maintenanceBill.groupBy({
      by: ['flatId'],
      where: {
        societyId,
        flatId: { in: flatIds },
        isPublished: true,
        isPaid: false,
        // Earlier months only. Arrears are what was left unpaid BEFORE this month; counting every
        // other period also pulled later months' bills into an older statement.
        billingPeriod: {
          OR: [
            { periodYear: { lt: period.periodYear } },
            { periodYear: period.periodYear, periodMonth: { lt: period.periodMonth } },
          ],
        },
      },
      _sum: { pendingAmount: true },
    });
    const arrearsMap = new Map<string, number>();
    for (const r of arrearsRows) {
      arrearsMap.set(r.flatId, r._sum.pendingAmount?.toNumber() ?? 0);
    }

    const statements = bills.map((bill) => {
      const resident = bill.flat.memberships[0]?.user ?? null;
      const water = waterByFlat.get(bill.flatId) ?? null;
      const arrears = arrearsMap.get(bill.flatId) ?? 0;

      const generalMaintenance = bill.baseAmount.toNumber();
      const waterCharges = bill.waterCharges.toNumber();
      const adjustments = bill.adjustments.toNumber();
      const lateFee = bill.lateFee.toNumber();
      const otherCharges = bill.otherCharges.toNumber();
      const totalPayable = generalMaintenance + waterCharges + adjustments + lateFee + otherCharges + arrears;

      return {
        flatCode: bill.flatCode,
        flatId: bill.flatId,
        billId: bill.id,
        invoiceNumber: bill.invoiceNumber,
        isPaid: bill.isPaid,
        isPublished: bill.isPublished,
        notes: bill.notes ?? null,
        residentName: resident ? `${resident.firstName} ${resident.lastName}` : '—',
        residentPhone: resident?.phone ?? null,
        generalMaintenance,
        waterReading: water
          ? {
              openingReading: water.openingReading.toNumber(),
              closingReading: water.closingReading.toNumber(),
              consumption: water.consumption.toNumber(),
              unit: water.unit,
              effectiveRate: water.effectiveRate?.toNumber() ?? null,
              waterCharges: water.calculatedAmount?.toNumber() ?? null,
            }
          : null,
        waterCharges,
        adjustments,
        lateFee,
        otherCharges,
        arrears,
        totalPayable,
        advanceApplied: advanceByBill.get(bill.id) ?? 0,
        advanceBalance: bill.flat.creditBalance.toNumber(),
      };
    });

    return {
      period: {
        id: period.id,
        periodYear: period.periodYear,
        periodMonth: period.periodMonth,
        startDate: period.startDate,
        endDate: period.endDate,
        dueDate: period.dueDate,
        status: period.status,
        totalBilled: period.totalBilled.toNumber(),
        totalCollected: period.totalCollected.toNumber(),
        totalPending: period.totalPending.toNumber(),
      },
      statements,
    };
  }

  async updateBillNotes(societyId: string, billId: string, notes: string) {
    await this.findBillById(societyId, billId);
    return this.prisma.maintenanceBill.update({
      where: { id: billId },
      data: { notes: notes || null },
      select: { id: true, notes: true },
    });
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

    // Increment rather than writing a total computed from the figure read
    // above: two adjustments applied to the same bill together would each
    // start from the same stale total and the second would erase the first.
    // pendingAmount is then derived from the post-increment values, so it
    // cannot disagree with the total it was calculated from.
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.maintenanceBill.update({
        where: { id: billId },
        data: {
          adjustments: { increment: adjustment },
          totalAmount: { increment: adjustment },
          notes: note,
        },
      });

      const pending = updated.totalAmount.minus(updated.paidAmount);
      return tx.maintenanceBill.update({
        where: { id: billId },
        data: {
          pendingAmount: pending.lessThan(0) ? new Prisma.Decimal(0) : pending,
          isPaid: pending.lessThanOrEqualTo(0),
        },
      });
    });
  }
}
