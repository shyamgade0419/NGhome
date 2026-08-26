import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export interface CreateFundDto {
  name: string;
  description?: string;
  accountId?: string;
  openingBalance?: number;
  isVisibleToResidents?: boolean;
}

@Injectable()
export class FundsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(societyId: string, dto: CreateFundDto) {
    return this.prisma.fund.create({
      data: {
        societyId,
        name: dto.name,
        description: dto.description,
        accountId: dto.accountId,
        openingBalance: dto.openingBalance
          ? new Prisma.Decimal(dto.openingBalance)
          : new Prisma.Decimal(0),
        currentBalance: dto.openingBalance
          ? new Prisma.Decimal(dto.openingBalance)
          : new Prisma.Decimal(0),
        isVisibleToResidents: dto.isVisibleToResidents ?? false,
      },
    });
  }

  async findAll(societyId: string, forResident = false) {
    return this.prisma.fund.findMany({
      where: {
        societyId,
        isActive: true,
        ...(forResident ? { isVisibleToResidents: true } : {}),
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(societyId: string, id: string, forResident = false) {
    const fund = await this.prisma.fund.findFirst({
      where: {
        id,
        societyId,
        // DEFECT-7: Residents cannot access non-resident-visible funds by direct ID
        ...(forResident ? { isVisibleToResidents: true } : {}),
      },
    });
    if (!fund) throw new NotFoundException('Fund not found');
    return fund;
  }

  async update(societyId: string, id: string, dto: Partial<CreateFundDto>) {
    await this.findOne(societyId, id);
    return this.prisma.fund.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        accountId: dto.accountId,
        isVisibleToResidents: dto.isVisibleToResidents,
      },
    });
  }
}
