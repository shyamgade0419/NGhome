import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, AnnouncementPriority, AnnouncementAudience } from '@prisma/client';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { audienceProblem, cleanAudienceConfig } from '../notifications/audience';
import { announcementNotice } from '../notifications/notification-content';
export { CreateAnnouncementDto } from './dto/create-announcement.dto';

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * Tells the audience, as an in-app notification and a phone alert, the moment an announcement is live. One scheduled for
   * later is left to the scheduled job, which sends it when its time comes. Never fails the post if the alert cannot go.
   */
  private async tellAudience(a: { id: string; societyId: string; title: string; content: string; priority: string; audience: AnnouncementAudience; audienceConfig: Prisma.JsonValue; publishAt: Date | null; expiresAt: Date | null; createdById: string }, actorId?: string) {
    if (!this.notifications) return;
    const now = new Date();
    if (a.publishAt && a.publishAt > now) return;
    if (a.expiresAt && a.expiresAt < now) return;
    await this.notifications.notifyQuietly(async () => {
      if (await this.notifications!.alreadySent(a.societyId, 'ANNOUNCEMENT', 'announcementId', a.id)) return;
      await this.notifications!.send(
        a.societyId,
        { ...announcementNotice(a), audience: a.audience, audienceConfig: a.audienceConfig as { buildingIds?: string[]; flatIds?: string[] } },
        { excludeUserId: actorId ?? a.createdById },
      );
    }, `announcement ${a.id}`);
  }

  async create(societyId: string, createdById: string, dto: CreateAnnouncementDto) {
    const now = new Date();
    const audience = dto.audience ?? AnnouncementAudience.ALL_RESIDENTS;
    const audienceConfig = cleanAudienceConfig(dto.audienceConfig);
    const problem = audienceProblem(audience, audienceConfig);
    if (problem) throw new BadRequestException(problem);
    const created = await this.prisma.announcement.create({
      data: {
        societyId,
        createdById,
        title: dto.title,
        content: dto.content,
        priority: dto.priority ?? AnnouncementPriority.NORMAL,
        audience,
        audienceConfig: audienceConfig as Prisma.InputJsonValue,
        publishAt: dto.publishAt ? new Date(dto.publishAt) : undefined,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        isPublished: dto.isPublished ?? false,
        publishedAt: dto.isPublished ? now : undefined,
      },
    });
    if (created.isPublished) await this.tellAudience(created, createdById);
    return created;
  }

  async publish(societyId: string, id: string, actorId?: string) {
    await this.findOne(societyId, id);
    const published = await this.prisma.announcement.update({
      where: { id },
      data: { isPublished: true, publishedAt: new Date() },
    });
    await this.tellAudience(published, actorId);
    return published;
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

  async remove(societyId: string, id: string) {
    // findOne enforces society scope before deleting
    await this.findOne(societyId, id);
    await this.prisma.announcement.delete({ where: { id } });
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
