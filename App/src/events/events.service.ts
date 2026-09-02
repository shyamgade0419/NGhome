import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, EventStatus } from '@prisma/client';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';

export interface CreateEventDto {
  title: string;
  description?: string;
  eventDate: string;
  fundId?: string;
  estimatedCost?: number;
  actualCost?: number;
  status?: EventStatus;
  isVisibleToResidents?: boolean;
}

const FUND_SELECT = { id: true, name: true } satisfies Prisma.FundSelect;
const CREATOR_SELECT = { id: true, firstName: true, lastName: true } satisfies Prisma.UserSelect;

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(societyId: string, createdById: string, dto: CreateEventDto) {
    return this.prisma.event.create({
      data: {
        societyId,
        createdById,
        title: dto.title,
        description: dto.description,
        eventDate: new Date(dto.eventDate),
        fundId: dto.fundId,
        estimatedCost: dto.estimatedCost != null ? new Prisma.Decimal(dto.estimatedCost) : undefined,
        actualCost: dto.actualCost != null ? new Prisma.Decimal(dto.actualCost) : undefined,
        status: dto.status ?? EventStatus.PLANNED,
        isVisibleToResidents: dto.isVisibleToResidents ?? true,
      },
      include: { fund: { select: FUND_SELECT }, createdBy: { select: CREATOR_SELECT } },
    });
  }

  async findAll(societyId: string, page: number, limit: number, forResident = false) {
    const { skip, take } = getPaginationParams({ page, limit });
    const where: Prisma.EventWhereInput = {
      societyId,
      ...(forResident ? { isVisibleToResidents: true } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.event.findMany({
        skip,
        take,
        where,
        include: { fund: { select: FUND_SELECT }, createdBy: { select: CREATOR_SELECT } },
        orderBy: { eventDate: 'asc' },
      }),
      this.prisma.event.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(societyId: string, id: string, forResident = false) {
    const event = await this.prisma.event.findFirst({
      where: {
        id,
        societyId,
        ...(forResident ? { isVisibleToResidents: true } : {}),
      },
      include: { fund: { select: FUND_SELECT }, createdBy: { select: CREATOR_SELECT } },
    });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async update(societyId: string, id: string, dto: Partial<CreateEventDto>) {
    // findOne (admin context — forResident=false) enforces society scope before updating
    await this.findOne(societyId, id);
    return this.prisma.event.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        eventDate: dto.eventDate ? new Date(dto.eventDate) : undefined,
        fundId: dto.fundId,
        estimatedCost: dto.estimatedCost != null ? new Prisma.Decimal(dto.estimatedCost) : undefined,
        actualCost: dto.actualCost != null ? new Prisma.Decimal(dto.actualCost) : undefined,
        status: dto.status,
        isVisibleToResidents: dto.isVisibleToResidents,
      },
      include: { fund: { select: FUND_SELECT }, createdBy: { select: CREATOR_SELECT } },
    });
  }

  async remove(societyId: string, id: string) {
    await this.findOne(societyId, id);
    await this.prisma.event.delete({ where: { id } });
  }
}
