import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AnnouncementAudience, NotificationChannel, NotificationStatus, SystemRole, Prisma,
} from '@prisma/client';

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
    const audience = dto.audience ?? AnnouncementAudience.ALL_RESIDENTS;

    const notification = await this.prisma.notification.create({
      data: {
        societyId,
        title: dto.title,
        body: dto.body,
        type: dto.type,
        data: (dto.data ?? {}) as Prisma.InputJsonValue,
        channels: dto.channels ?? [NotificationChannel.IN_APP],
        audience,
        scheduledAt: new Date(),
      },
    });

    // This used to be the entire method — it created the Notification
    // ("what was sent") but never a single NotificationRecord ("who it
    // was sent to"), and findMyNotifications() only ever reads from
    // NotificationRecord. Every "Send to All Members" click, on web or
    // mobile, has been reaching nobody's inbox since this feature was
    // built — not residents, not the admin who sent it.
    const recipientUserIds = await this.resolveRecipientUserIds(societyId, audience);
    if (recipientUserIds.length > 0) {
      await this.prisma.notificationRecord.createMany({
        data: recipientUserIds.map((userId) => ({
          notificationId: notification.id,
          userId,
          channel: NotificationChannel.IN_APP,
          status: NotificationStatus.SENT,
          sentAt: new Date(),
        })),
      });
    }

    return notification;
  }

  /**
   * Every UI that composes a notification today (web and mobile) sends
   * with no audience override, so this always resolves via the
   * ALL_RESIDENTS default — and the button both clients show literally
   * says "Send to All Members", not "all residents", so that default
   * fans out to every active membership regardless of role (admin,
   * staff, committee, resident alike) rather than residents only.
   * STAFF/COMMITTEE narrow correctly if a client ever does send them.
   * BUILDING/BLOCK/SPECIFIC_FLATS aren't reachable from any UI yet and
   * fall back to "everyone" too — reaching everyone beats reaching no
   * one if this ever gets hit before those are actually implemented.
   *
   * `distinct: ['userId']` matters now that one person can hold two
   * memberships in the same society (e.g. a society admin who's also a
   * resident of their own flat) — without it they'd get the exact same
   * notification twice.
   */
  private async resolveRecipientUserIds(
    societyId: string,
    audience: AnnouncementAudience,
  ): Promise<string[]> {
    const roleFilter =
      audience === AnnouncementAudience.STAFF
        ? { role: SystemRole.SOCIETY_STAFF }
        : audience === AnnouncementAudience.COMMITTEE
          ? { role: SystemRole.COMMITTEE_MEMBER }
          : {};

    const memberships = await this.prisma.societyMembership.findMany({
      where: { societyId, status: 'ACTIVE', ...roleFilter },
      select: { userId: true },
      distinct: ['userId'],
    });
    return memberships.map((m) => m.userId);
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

  /** Powers the bell-icon badge — there was previously no way to know
   *  unread notifications existed without opening the list. Matches
   *  toNotification()'s own read/unread rule on the client (status READ
   *  or a set readAt), checked directly rather than fetching every row
   *  just to count them. */
  async getUnreadCount(userId: string) {
    const count = await this.prisma.notificationRecord.count({
      where: { userId, status: { not: 'READ' }, readAt: null },
    });
    return { count };
  }
}
