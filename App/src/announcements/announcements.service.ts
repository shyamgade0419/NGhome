import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, AnnouncementPriority, AnnouncementAudience } from '@prisma/client';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';

export interface CreateAnnouncementDto {
  title: string;
  content: string;
  priority?: AnnouncementPriority;
  audience?: AnnouncementAudience;
  publishAt?: string;
  expiresAt?: string;
  isPublished?: boolean;
}

@Injectable()
export class AnnouncementsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(societyId: string, createdById: string, dto: CreateAnnouncementDto) {
    const now = new Date();
    return this.prisma.announcement.create({
      data: {
        societyId,
        createdById,
        title: dto.title,
        content: dto.content,
        priority: dto.priority ?? AnnouncementPriority.NORMAL,
        audience: dto.audience ?? AnnouncementAudience.ALL_RESIDENTS,
        publishAt: dto.publishAt ? new Date(dto.publishAt) : undefined,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        isPublished: dto.isPublished ?? false,
        publishedAt: dto.isPublished ? now : undefined,
      },
    });
  }

  async publish(societyId: string, id: string) {
    await this.findOne(societyId, id);
    return this.prisma.announcement.update({
      where: { id },
      data: { isPublished: true, publishedAt: new Date() },
    });
  }

  async findAll(societyId: string, page: number, limit: number, forResident = false) {
    const { skip, take } = getPaginationParams({ page, limit });
    const now = new Date();
    const where: Prisma.AnnouncementWhereInput = {
      societyId,
      ...(forResident
        ? {
            isPublished: true,
            OR: [{ publishAt: null }, { publishAt: { lte: now } }],
            AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.announcement.findMany({
        skip,
        take,
        where,
        include: { createdBy: { select: { id: true, firstName: true, lastName: true } } },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.announcement.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(societyId: string, id: string, forResident = false) {
    const now = new Date();
    const announcement = await this.prisma.announcement.findFirst({
      where: {
        id,
        societyId,
        ...(forResident
          ? {
              isPublished: true,
              OR: [{ publishAt: null }, { publishAt: { lte: now } }],
              AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }],
            }
          : {}),
      },
    });
    if (!announcement) throw new NotFoundException('Announcement not found');
    return announcement;
  }

  async update(societyId: string, id: string, dto: Partial<CreateAnnouncementDto>) {
    await this.findOne(societyId, id);
    return this.prisma.announcement.update({
      where: { id },
      data: {
        title: dto.title,
        content: dto.content,
        priority: dto.priority,
        audience: dto.audience,
        publishAt: dto.publishAt ? new Date(dto.publishAt) : undefined,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });
  }
}
