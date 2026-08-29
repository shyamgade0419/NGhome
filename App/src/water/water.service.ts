import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, WaterBillingModel } from '@prisma/client';

export interface CreateWaterConfigDto {
  name: string;
  billingModel: WaterBillingModel;
  effectiveFrom: string;
  effectiveTo?: string;
  config: Record<string, unknown>;
}

export interface RecordReadingDto {
  flatId: string;
  waterConfigId?: string;
  billingPeriodId?: string;
  readingDate: string;
  openingReading: number;
  closingReading: number;
  unit?: string;
  notes?: string;
}

export interface FlatReadingInput {
  flatId: string;
  openingReading: number;
  closingReading: number;
  notes?: string;
}

export interface AllocateWaterCostsDto {
  billingPeriodId: string;
  readingDate: string;
  /** Municipal water board bill for the month */
  municipalWaterBill: number;
  /** Tanker water charges for the month */
  tankerCost: number;
  /** Total common electricity bill (all usage) */
  commonElectricityBill: number;
  /** Percentage (0–100) of common electricity attributed to water motor/pump */
  electricityWaterPercent: number;
  /** Per-flat readings */
  readings: FlatReadingInput[];
}

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
    if (dto.closingReading < dto.openingReading) {
      throw new BadRequestException('Closing reading must be greater than or equal to opening reading');
    }

    if (dto.billingPeriodId) {
      const period = await this.prisma.billingPeriod.findFirst({
        where: { id: dto.billingPeriodId, societyId },
      });
      if (!period) throw new NotFoundException('Billing period not found in this society');
    }

    const consumption = dto.closingReading - dto.openingReading;

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

    // Validate all flats belong to this society
    const flatIds = dto.readings.map((r) => r.flatId);
    const flats = await this.prisma.flat.findMany({
      where: { id: { in: flatIds }, societyId },
      select: { id: true, flatCode: true },
    });
    if (flats.length !== flatIds.length) {
      throw new BadRequestException('One or more flat IDs are invalid or do not belong to this society');
    }

    // Validate readings
    for (const r of dto.readings) {
      if (r.openingReading < 0 || r.closingReading < 0) {
        throw new BadRequestException(`Negative readings not allowed for flat ${r.flatId}`);
      }
      if (r.closingReading < r.openingReading) {
        throw new BadRequestException(`Closing reading must be ≥ opening reading for flat ${r.flatId}`);
      }
    }

    // Calculate total cost
    const electricityWaterCost =
      (dto.electricityWaterPercent / 100) * dto.commonElectricityBill;
    const totalWaterCost =
      dto.municipalWaterBill + dto.tankerCost + electricityWaterCost;

    // Calculate total units consumed
    const totalUnits = dto.readings.reduce(
      (sum, r) => sum + (r.closingReading - r.openingReading),
      0,
    );

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

    const readingDate = new Date(dto.readingDate);
    const results: Array<{
      flatId: string;
      flatCode: string;
      openingReading: number;
      closingReading: number;
      consumption: number;
      ratePerUnit: number;
      charge: number;
    }> = [];

    // Upsert water readings for each flat
    await this.prisma.$transaction(async (tx) => {
      // Delete existing readings for this period (to allow re-calculation)
      await tx.waterMeterReading.deleteMany({
        where: { societyId, billingPeriodId: dto.billingPeriodId },
      });

      for (const r of dto.readings) {
        const consumption = r.closingReading - r.openingReading;
        const charge = consumption * ratePerUnit;

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
            calculatedAmount: new Prisma.Decimal(charge),
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
