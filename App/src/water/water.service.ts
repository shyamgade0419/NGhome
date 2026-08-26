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

    // Validate reading values
    if (dto.openingReading < 0 || dto.closingReading < 0) {
      throw new BadRequestException('Water meter readings cannot be negative');
    }
    if (dto.closingReading < dto.openingReading) {
      throw new BadRequestException('Closing reading must be greater than or equal to opening reading');
    }

    // Validate billingPeriodId belongs to this society
    if (dto.billingPeriodId) {
      const period = await this.prisma.billingPeriod.findFirst({
        where: { id: dto.billingPeriodId, societyId },
      });
      if (!period) throw new NotFoundException('Billing period not found in this society');
    }

    const consumption = dto.closingReading - dto.openingReading;

    let effectiveRate: number | undefined;
    let calculatedAmount: number | undefined;

    // DEFECT-2: Reject waterConfigId that doesn't exist or belongs to another society
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
      default:
        return {};
    }
  }
}
