import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, WaterBillingModel } from '@prisma/client';
import { CreateWaterConfigDto } from './dto/create-water-config.dto';
import { RecordReadingDto } from './dto/record-reading.dto';
import { AllocateWaterCostsDto } from './dto/allocate-water-costs.dto';
import { readingOrderMessage, waterConsumption } from './water-rules';
import { describeUsageLimit, readUsageLimit, validateUsageLimit, waterCharge, type UsageLimit } from './water-usage-limit';
export { CreateWaterConfigDto } from './dto/create-water-config.dto';
export { RecordReadingDto } from './dto/record-reading.dto';
export { AllocateWaterCostsDto, FlatReadingInputDto as FlatReadingInput } from './dto/allocate-water-costs.dto';

@Injectable()
export class WaterService {
  constructor(private readonly prisma: PrismaService) {}

  async createConfig(societyId: string, dto: CreateWaterConfigDto) {
    return this.prisma.waterBillingConfig.create({
      data: {
        societyId,
        name: dto.name,
        billingModel: dto.billingModel,
        effectiveFrom: new Date(dto.effectiveFrom),
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
        config: dto.config as Prisma.InputJsonValue,
      },
    });
  }

  async findConfigs(societyId: string) {
    return this.prisma.waterBillingConfig.findMany({
      where: { societyId },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async recordReading(societyId: string, dto: RecordReadingDto) {
    // Verify flat belongs to society
    const flat = await this.prisma.flat.findFirst({ where: { id: dto.flatId, societyId } });
    if (!flat) throw new NotFoundException('Flat not found in this society');

    if (dto.openingReading < 0 || dto.closingReading < 0) {
      throw new BadRequestException('Water meter readings cannot be negative');
    }
    const consumption = waterConsumption(dto.openingReading, dto.closingReading, flat.waterMeterReversed);
    if (consumption === null) {
      throw new BadRequestException(readingOrderMessage(flat.waterMeterReversed));
    }

    if (dto.billingPeriodId) {
      const period = await this.prisma.billingPeriod.findFirst({
        where: { id: dto.billingPeriodId, societyId },
      });
      if (!period) throw new NotFoundException('Billing period not found in this society');
    }

    let effectiveRate: number | undefined;
    let calculatedAmount: number | undefined;

    if (dto.waterConfigId) {
      const config = await this.prisma.waterBillingConfig.findFirst({
        where: { id: dto.waterConfigId, societyId },
      });
      if (!config) throw new NotFoundException('Water billing configuration not found in this society');
      const calculated = this.calculateWaterAmount(consumption, config.billingModel, config.config as Record<string, unknown>);
      effectiveRate = calculated.rate;
      calculatedAmount = calculated.amount;
    }

    return this.prisma.waterMeterReading.create({
      data: {
        societyId,
        flatId: dto.flatId,
        waterConfigId: dto.waterConfigId,
        billingPeriodId: dto.billingPeriodId,
        readingDate: new Date(dto.readingDate),
        openingReading: new Prisma.Decimal(dto.openingReading),
        closingReading: new Prisma.Decimal(dto.closingReading),
        consumption: new Prisma.Decimal(consumption),
        unit: dto.unit ?? 'KL',
        effectiveRate: effectiveRate ? new Prisma.Decimal(effectiveRate) : undefined,
        calculatedAmount: calculatedAmount ? new Prisma.Decimal(calculatedAmount) : undefined,
        notes: dto.notes,
      },
    });
  }

  async findReadings(societyId: string, billingPeriodId?: string, flatId?: string) {
    return this.prisma.waterMeterReading.findMany({
      where: {
        societyId,
        ...(billingPeriodId ? { billingPeriodId } : {}),
        ...(flatId ? { flatId } : {}),
      },
      include: { flat: { select: { id: true, flatCode: true } } },
      orderBy: { readingDate: 'desc' },
    });
  }

  /**
   * Society Allocation model:
   * - Admin enters all flat readings + composite cost breakdown for the period
   * - Total water cost = municipal + tanker + (electricity % × common electricity bill)
   * - Rate per unit = total cost / total units consumed across all flats
   * - Each flat's charge = their consumption × rate per unit
   * - Creates/upserts WaterMeterReading per flat with calculatedAmount set
   */
  async allocatePeriodWaterCosts(societyId: string, dto: AllocateWaterCostsDto) {
    // Validate billing period
    const period = await this.prisma.billingPeriod.findFirst({
      where: { id: dto.billingPeriodId, societyId },
    });
    if (!period) throw new NotFoundException('Billing period not found');

    if (!['DRAFT', 'CALCULATED', 'REVIEW'].includes(period.status)) {
      throw new BadRequestException('Water charges can only be set for periods in DRAFT, CALCULATED, or REVIEW status');
    }

    if (!dto.readings || dto.readings.length === 0) {
      throw new BadRequestException('At least one flat reading is required');
    }

    // A usage limit sent with the readings is checked up front, so a bad one never gets as far as the database.
    if (dto.usageLimit) {
      const problem = validateUsageLimit(dto.usageLimit);
      if (problem) throw new BadRequestException(problem);
    }

    // Validate all flats belong to this society
    const flatIds = dto.readings.map((r) => r.flatId);
    const flats = await this.prisma.flat.findMany({
      where: { id: { in: flatIds }, societyId },
      select: { id: true, flatCode: true, waterMeterReversed: true },
    });
    if (flats.length !== flatIds.length) {
      throw new BadRequestException('One or more flat IDs are invalid or do not belong to this society');
    }

    // Validate readings, and work out each flat's units the way its own meter counts
    const consumptionByFlat = new Map<string, number>();
    for (const r of dto.readings) {
      if (r.openingReading < 0 || r.closingReading < 0) {
        throw new BadRequestException(`Negative readings not allowed for flat ${r.flatId}`);
      }
      const flat = flats.find((f) => f.id === r.flatId)!;
      const used = waterConsumption(r.openingReading, r.closingReading, flat.waterMeterReversed);
      if (used === null) {
        throw new BadRequestException(readingOrderMessage(flat.waterMeterReversed, `Flat ${flat.flatCode}`));
      }
      consumptionByFlat.set(r.flatId, used);
    }

    // Calculate total cost
    const electricityWaterCost =
      (dto.electricityWaterPercent / 100) * dto.commonElectricityBill;
    const totalWaterCost =
      dto.municipalWaterBill + dto.tankerCost + electricityWaterCost;

    // Calculate total units consumed
    const totalUnits = dto.readings.reduce((sum, r) => sum + consumptionByFlat.get(r.flatId)!, 0);

    if (totalUnits <= 0) {
      throw new BadRequestException('Total water consumption across all flats must be greater than zero');
    }

    const ratePerUnit = totalWaterCost / totalUnits;

    // Get or find SOCIETY_ALLOCATION config for this society
    let config = await this.prisma.waterBillingConfig.findFirst({
      where: { societyId, billingModel: 'SOCIETY_ALLOCATION' },
      orderBy: { createdAt: 'desc' },
    });

    // Auto-create a SOCIETY_ALLOCATION config if none exists
    if (!config) {
      config = await this.prisma.waterBillingConfig.create({
        data: {
          societyId,
          name: 'Society Water Allocation',
          billingModel: 'SOCIETY_ALLOCATION',
          effectiveFrom: period.startDate,
          config: {} as Prisma.InputJsonValue,
        },
      });
    }

    // The limit: the one sent with these readings (saved below), none if it was switched off, or whatever
    // the society has already saved. Units above it are charged more; the normal rate stays the same.
    const savedLimit = readUsageLimit(config.config);
    const limit: UsageLimit | null =
      dto.usageLimit === undefined
        ? savedLimit
        : dto.usageLimit === null
          ? null
          : { limitUnits: dto.usageLimit.limitUnits, mode: dto.usageLimit.mode, value: dto.usageLimit.value };

    const readingDate = new Date(dto.readingDate);
    const results: Array<{
      flatId: string;
      flatCode: string;
      openingReading: number;
      closingReading: number;
      consumption: number;
      ratePerUnit: number;
      /** Every unit at the normal rate. */
      baseCharge: number;
      /** Units above the usage limit, and what they cost on top of the normal rate. */
      excessUnits: number;
      excessCharge: number;
      /** What the flat pays: the base plus the extra. */
      charge: number;
    }> = [];

    // Upsert water readings for each flat
    await this.prisma.$transaction(async (tx) => {
      // The rule is part of the society's water rules, so it is saved with the readings it was applied to:
      // both land or neither does, and next month starts from the same limit.
      if (dto.usageLimit !== undefined) {
        const rest = { ...((config!.config as Record<string, unknown>) ?? {}) };
        delete rest['usageLimit'];
        await tx.waterBillingConfig.update({
          where: { id: config!.id },
          data: { config: (limit ? { ...rest, usageLimit: limit } : rest) as Prisma.InputJsonValue },
        });
      }

      // Delete existing readings for this period (to allow re-calculation)
      await tx.waterMeterReading.deleteMany({
        where: { societyId, billingPeriodId: dto.billingPeriodId },
      });

      for (const r of dto.readings) {
        const consumption = consumptionByFlat.get(r.flatId)!;
        const priced = waterCharge(consumption, ratePerUnit, limit);
        const charge = priced.total.toNumber();

        await tx.waterMeterReading.create({
          data: {
            societyId,
            flatId: r.flatId,
            waterConfigId: config!.id,
            billingPeriodId: dto.billingPeriodId,
            readingDate,
            openingReading: new Prisma.Decimal(r.openingReading),
            closingReading: new Prisma.Decimal(r.closingReading),
            consumption: new Prisma.Decimal(consumption),
            unit: 'KL',
            effectiveRate: new Prisma.Decimal(ratePerUnit),
            calculatedAmount: priced.total,
            // Recorded only when a limit applied (0 for a flat that stayed within it), so the bill can say so.
            excessUnits: limit ? priced.excessUnits : null,
            excessCharge: limit ? priced.excessCharge : null,
            notes: r.notes,
          },
        });

        const flat = flats.find((f) => f.id === r.flatId);
        results.push({
          flatId: r.flatId,
          flatCode: flat?.flatCode ?? r.flatId,
          openingReading: r.openingReading,
          closingReading: r.closingReading,
          consumption,
          ratePerUnit,
          baseCharge: priced.baseCharge.toDecimalPlaces(2).toNumber(),
          excessUnits: priced.excessUnits.toNumber(),
          excessCharge: priced.excessCharge.toNumber(),
          charge,
        });
      }
    });

    return {
      costBreakdown: {
        municipalWaterBill: dto.municipalWaterBill,
        tankerCost: dto.tankerCost,
        commonElectricityBill: dto.commonElectricityBill,
        electricityWaterPercent: dto.electricityWaterPercent,
        electricityWaterCost,
        totalWaterCost,
      },
      totalUnits,
      ratePerUnit,
      // The rule these charges used, in words, and how much of the total it added. Null when there is none.
      usageLimit: limit,
      usageLimitText: limit ? describeUsageLimit(limit) : null,
      excessTotal: results.reduce((sum, r) => sum + r.excessCharge, 0),
      flatCount: results.length,
      flatReadings: results,
    };
  }

  async getPeriodWaterSummary(societyId: string, periodId: string) {
    const period = await this.prisma.billingPeriod.findFirst({
      where: { id: periodId, societyId },
    });
    if (!period) throw new NotFoundException('Billing period not found');

    const readings = await this.prisma.waterMeterReading.findMany({
      where: { societyId, billingPeriodId: periodId },
      include: { flat: { select: { id: true, flatCode: true } } },
      orderBy: [{ flat: { flatCode: 'asc' } }],
    });

    const totalUnits = readings.reduce(
      (sum, r) => sum + r.consumption.toNumber(),
      0,
    );
    const totalCharge = readings.reduce(
      (sum, r) => sum + (r.calculatedAmount?.toNumber() ?? 0),
      0,
    );
    const totalExcess = readings.reduce((sum, r) => sum + (r.excessCharge?.toNumber() ?? 0), 0);
    const ratePerUnit =
      readings.length > 0 && readings[0].effectiveRate
        ? readings[0].effectiveRate.toNumber()
        : totalUnits > 0
        ? totalCharge / totalUnits
        : 0;

    return {
      periodId,
      periodLabel: `${period.periodMonth}/${period.periodYear}`,
      readingCount: readings.length,
      totalUnits,
      totalCharge,
      /** How much of totalCharge came from units above the usage limit. */
      totalExcess,
      ratePerUnit,
      readings: readings.map((r) => ({
        id: r.id,
        flatId: r.flatId,
        flatCode: r.flat.flatCode,
        readingDate: r.readingDate,
        openingReading: r.openingReading.toNumber(),
        closingReading: r.closingReading.toNumber(),
        consumption: r.consumption.toNumber(),
        unit: r.unit,
        effectiveRate: r.effectiveRate?.toNumber() ?? null,
        calculatedAmount: r.calculatedAmount?.toNumber() ?? null,
        excessUnits: r.excessUnits?.toNumber() ?? null,
        excessCharge: r.excessCharge?.toNumber() ?? null,
        notes: r.notes,
      })),
    };
  }

  private calculateWaterAmount(
    consumption: number,
    model: WaterBillingModel,
    config: Record<string, unknown>,
  ): { rate?: number; amount?: number } {
    switch (model) {
      case 'PER_LITRE': {
        const rate = (config['ratePerLitre'] as number) ?? 0;
        return { rate, amount: consumption * 1000 * rate };
      }
      case 'PER_KL': {
        const rate = (config['ratePerKL'] as number) ?? 0;
        return { rate, amount: consumption * rate };
      }
      case 'FIXED_CHARGE': {
        const amount = (config['fixedAmount'] as number) ?? 0;
        return { amount };
      }
      case 'FIXED_PLUS_USAGE': {
        const fixed = (config['fixedAmount'] as number) ?? 0;
        const rate = (config['ratePerKL'] as number) ?? 0;
        const minKL = (config['minimumKL'] as number) ?? 0;
        const billableKL = Math.max(0, consumption - minKL);
        return { rate, amount: fixed + billableKL * rate };
      }
      case 'SLAB_BASED': {
        const slabs = (config['slabs'] as { upTo: number; rate: number }[]) ?? [];
        let amount = 0;
        let remaining = consumption;
        let lastRate = 0;
        for (const slab of slabs) {
          if (remaining <= 0) break;
          const inSlab = Math.min(remaining, slab.upTo);
          amount += inSlab * slab.rate;
          remaining -= inSlab;
          lastRate = slab.rate;
        }
        if (remaining > 0) amount += remaining * lastRate;
        return { amount };
      }
      case 'SOCIETY_ALLOCATION':
        // Rate is computed externally via allocatePeriodWaterCosts().
        // Individual readings get their effectiveRate and calculatedAmount set during allocation.
        return {};
      default:
        return {};
    }
  }
}
