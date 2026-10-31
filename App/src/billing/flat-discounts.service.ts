import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFlatDiscountDto, UpdateFlatDiscountDto } from './dto/flat-discount.dto';
import { discountStatus } from './flat-discounts';

/**
 * Standing discounts for a flat. They change what bills are generated from now on; a bill already generated
 * keeps its figures until the period is regenerated, which is when this discount (or its removal) shows.
 */
@Injectable()
export class FlatDiscountsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(societyId: string) {
    const rows = await this.prisma.flatDiscount.findMany({
      where: { societyId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: {
        flat: {
          select: {
            flatCode: true,
            memberships: {
              where: { status: 'ACTIVE', role: 'RESIDENT' },
              take: 1,
              select: { user: { select: { firstName: true, lastName: true } } },
            },
          },
        },
      },
    });
    const now = new Date();
    return rows.map((r) => {
      const user = r.flat.memberships[0]?.user;
      return {
        id: r.id,
        flatId: r.flatId,
        flatCode: r.flat.flatCode,
        residentName: user ? `${user.firstName} ${user.lastName}`.trim() : null,
        type: r.type,
        value: r.value.toString(),
        reason: r.reason,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
        isActive: r.isActive,
        status: discountStatus(r, now),
      };
    });
  }

  async create(societyId: string, actorId: string, dto: CreateFlatDiscountDto) {
    const flat = await this.prisma.flat.findFirst({ where: { id: dto.flatId, societyId, deletedAt: null }, select: { id: true, flatCode: true } });
    if (!flat) throw new NotFoundException('Flat not found');
    const from = new Date(dto.effectiveFrom);
    const to = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    this.check(dto.type, dto.value, from, to);

    const created = await this.prisma.flatDiscount.create({
      data: {
        societyId,
        flatId: flat.id,
        type: dto.type,
        value: new Prisma.Decimal(dto.value),
        reason: dto.reason.trim(),
        effectiveFrom: from,
        effectiveTo: to,
        createdById: actorId,
      },
    });
    await this.audit(societyId, actorId, created.id, null, { flat: flat.flatCode, type: dto.type, value: dto.value, reason: dto.reason, effectiveFrom: dto.effectiveFrom, effectiveTo: dto.effectiveTo ?? null });
    return created;
  }

  async update(societyId: string, actorId: string, id: string, dto: UpdateFlatDiscountDto) {
    const current = await this.prisma.flatDiscount.findFirst({ where: { id, societyId } });
    if (!current) throw new NotFoundException('Discount not found');

    const type = dto.type ?? current.type;
    const value = dto.value ?? current.value.toNumber();
    const from = dto.effectiveFrom ? new Date(dto.effectiveFrom) : current.effectiveFrom;
    const to = dto.effectiveTo === undefined ? current.effectiveTo : dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    this.check(type, value, from, to);

    const updated = await this.prisma.flatDiscount.update({
      where: { id },
      data: {
        type,
        value: new Prisma.Decimal(value),
        reason: dto.reason?.trim() ?? current.reason,
        effectiveFrom: from,
        effectiveTo: to,
        isActive: dto.isActive ?? current.isActive,
      },
    });
    await this.audit(
      societyId, actorId, id,
      { type: current.type, value: current.value.toString(), reason: current.reason, isActive: current.isActive },
      { type, value, reason: updated.reason, isActive: updated.isActive, effectiveFrom: from.toISOString(), effectiveTo: to?.toISOString() ?? null },
    );
    return updated;
  }

  async remove(societyId: string, actorId: string, id: string) {
    const current = await this.prisma.flatDiscount.findFirst({ where: { id, societyId }, include: { flat: { select: { flatCode: true } } } });
    if (!current) throw new NotFoundException('Discount not found');
    await this.prisma.flatDiscount.delete({ where: { id } });
    await this.audit(societyId, actorId, id, { flat: current.flat.flatCode, type: current.type, value: current.value.toString(), reason: current.reason }, null);
    return { success: true };
  }

  private check(type: string, value: number, from: Date, to: Date | null) {
    if (type === 'PERCENT' && value > 100) throw new BadRequestException('A percentage discount cannot be more than 100%.');
    if (to && to.getTime() < from.getTime()) throw new BadRequestException('The end date cannot be before the start date.');
  }

  private audit(societyId: string, actorId: string, id: string, oldValues: object | null, newValues: object | null) {
    return this.prisma.auditLog.create({
      data: {
        societyId,
        actorId,
        action: 'OTHER',
        entityType: 'FlatDiscount',
        entityId: id,
        oldValues: (oldValues ?? undefined) as Prisma.InputJsonValue | undefined,
        newValues: (newValues ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
