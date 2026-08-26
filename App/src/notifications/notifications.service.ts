import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnnouncementAudience, NotificationChannel, Prisma } from '@prisma/client';

export interface SendNotificationDto {
  title: string;
  body: string;
  type: string;
  data?: Record<string, unknown>;
  channels?: NotificationChannel[];
  audience?: AnnouncementAudience;
}

/**
 * Notification abstraction layer.
 * Stores notification records in DB; actual delivery (push/email/SMS)
 * is plugged in via external providers in a future phase.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async send(societyId: string, dto: SendNotificationDto) {
    return this.prisma.notification.create({
      data: {
        societyId,
        title: dto.title,
        body: dto.body,
        type: dto.type,
        data: (dto.data ?? {}) as Prisma.InputJsonValue,
        channels: dto.channels ?? [NotificationChannel.IN_APP],
        audience: dto.audience ?? AnnouncementAudience.ALL_RESIDENTS,
        scheduledAt: new Date(),
      },
    });
  }

  async findMyNotifications(userId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.notificationRecord.findMany({
        skip,
        take: limit,
        where: { userId },
        include: { notification: { select: { id: true, title: true, body: true, type: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.notificationRecord.count({ where: { userId } }),
    ]);
    return { data, total };
  }

  async markRead(userId: string, recordId: string) {
    return this.prisma.notificationRecord.updateMany({
      where: { id: recordId, userId },
      data: { status: 'READ', readAt: new Date() },
    });
  }
}
