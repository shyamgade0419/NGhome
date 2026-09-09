import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, AccountType } from '@prisma/client';

import { CreateAccountDto } from './dto/create-account.dto';
export { CreateAccountDto } from './dto/create-account.dto';

@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(societyId: string, dto: CreateAccountDto) {
    return this.prisma.account.create({
      data: {
        societyId,
        name: dto.name,
        accountType: dto.accountType,
        bankName: dto.bankName,
        accountNumberMasked: dto.accountNumberMasked,
        ifscCode: dto.ifscCode,
        openingBalance: dto.openingBalance
          ? new Prisma.Decimal(dto.openingBalance)
          : new Prisma.Decimal(0),
        currentBalance: dto.openingBalance
          ? new Prisma.Decimal(dto.openingBalance)
          : new Prisma.Decimal(0),
        description: dto.description,
      },
    });
  }

  async findAll(societyId: string) {
    return this.prisma.account.findMany({
      where: { societyId, isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(societyId: string, id: string) {
    const account = await this.prisma.account.findFirst({
      where: { id, societyId },
    });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  async update(societyId: string, id: string, dto: Partial<CreateAccountDto>) {
    await this.findOne(societyId, id);
    return this.prisma.account.update({
      where: { id },
      data: {
        name: dto.name,
        bankName: dto.bankName,
        description: dto.description,
        isActive: true,
      },
    });
  }

  async getTransactions(societyId: string, accountId: string, page: number, limit: number) {
    await this.findOne(societyId, accountId);
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.transaction.findMany({
        skip,
        take: limit,
        where: { societyId, accountId },
        orderBy: { transactionDate: 'desc' },
      }),
      this.prisma.transaction.count({ where: { societyId, accountId } }),
    ]);
    return { data, total, page, limit };
  }
}
