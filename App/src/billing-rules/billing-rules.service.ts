import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBillingRuleDto } from './dto/create-billing-rule.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class BillingRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(societyId: string, dto: CreateBillingRuleDto) {
    const { components, ...ruleData } = dto;

    return this.prisma.billingRule.create({
      data: {
        societyId,
        name: ruleData.name,
        description: ruleData.description,
        calculationType: ruleData.calculationType,
        effectiveFrom: new Date(ruleData.effectiveFrom),
        effectiveTo: ruleData.effectiveTo ? new Date(ruleData.effectiveTo) : undefined,
        priority: ruleData.priority ?? 0,
        config: ruleData.config as Prisma.InputJsonValue ?? {},
        applicableTo: ruleData.applicableTo as Prisma.InputJsonValue ?? {},
        components: components
          ? {
              create: components.map((c, idx) => ({
                name: c.name,
                description: c.description,
                componentType: c.componentType,
                calculationType: c.calculationType,
                amount: c.amount ? new Prisma.Decimal(c.amount) : undefined,
                rate: c.rate ? new Prisma.Decimal(c.rate) : undefined,
                config: c.config as Prisma.InputJsonValue ?? {},
                order: c.order ?? idx,
              })),
            }
          : undefined,
      },
      include: { components: { orderBy: { order: 'asc' } } },
    });
  }

  async findAll(societyId: string) {
    return this.prisma.billingRule.findMany({
      where: { societyId },
      include: { components: { orderBy: { order: 'asc' } } },
      orderBy: [{ priority: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  async findActive(societyId: string, asOf: Date = new Date()) {
    return this.prisma.billingRule.findMany({
      where: {
        societyId,
        isActive: true,
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOf } }],
      },
      include: { components: { where: { isActive: true }, orderBy: { order: 'asc' } } },
      orderBy: { priority: 'asc' },
    });
  }

  async findOne(societyId: string, id: string) {
    const rule = await this.prisma.billingRule.findFirst({
      where: { id, societyId },
      include: { components: { orderBy: { order: 'asc' } } },
    });
    if (!rule) throw new NotFoundException('Billing rule not found');
    return rule;
  }

  async update(societyId: string, id: string, dto: Partial<CreateBillingRuleDto>) {
    await this.findOne(societyId, id);
    // components is deliberately excluded from a flat update() — updating a
    // rule's components (each with their own id/order) is not implemented
    // here; only scalar fields on the rule itself are.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { components, ...ruleData } = dto;
    return this.prisma.billingRule.update({
      where: { id },
      data: {
        ...ruleData,
        effectiveFrom: ruleData.effectiveFrom ? new Date(ruleData.effectiveFrom) : undefined,
        effectiveTo: ruleData.effectiveTo ? new Date(ruleData.effectiveTo) : undefined,
        config: ruleData.config as Prisma.InputJsonValue,
        applicableTo: ruleData.applicableTo as Prisma.InputJsonValue,
      },
      include: { components: { orderBy: { order: 'asc' } } },
    });
  }

  async remove(societyId: string, id: string) {
    // findOne enforces society scope before deleting
    await this.findOne(societyId, id);
    await this.prisma.billingRule.delete({ where: { id } });
  }

  async setActive(societyId: string, id: string, isActive: boolean) {
    await this.findOne(societyId, id);
    return this.prisma.billingRule.update({ where: { id }, data: { isActive } });
  }
}
