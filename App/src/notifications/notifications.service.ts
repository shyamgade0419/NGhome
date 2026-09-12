import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  AnnouncementAudience, NotificationChannel, NotificationStatus, SystemRole, Prisma,
} from '@prisma/client';
import { PushService } from './push.service';
import { SendNotificationDto } from './dto/send-notification.dto';
export { SendNotificationDto } from './dto/send-notification.dto';

/**
 * Notification abstraction layer.
 * Stores notification records in DB (the in-app inbox) and, since both
 * previously only meant "wrote a database row nobody's phone ever
 * reacted to", also fans out to PushService for real push delivery — a
 * phone alert when the app isn't open, not just something waiting in the
 * list next time it's opened.
 */
@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
  ) {}

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

    // Fire-and-forget-ish (PushService swallows its own errors) — a slow
    // or failed push send must never turn a successfully saved
    // notification into a failed API response.
    void this.pushService.sendToUsers(recipientUserIds, dto.title, dto.body, { type: dto.type });

    return notification;
  }

  /**
   * Notify specific people rather than an audience.
   *
   * send() fans out by role, which suits an announcement but not the things
   * residents most want to hear about — their payment being approved, their
   * helpdesk ticket moving — where the audience is one person. Without this
   * there was no way to tell someone something about their own account, so
   * nothing did.
   *
   * Deduplicates userIds: a person holding two memberships in one society
   * would otherwise be told the same thing twice.
   */
  async sendToUsers(societyId: string, userIds: string[], dto: SendNotificationDto) {
    const recipients = [...new Set(userIds)].filter(Boolean);
    if (recipients.length === 0) return null;

    const notification = await this.prisma.notification.create({
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

    await this.prisma.notificationRecord.createMany({
      data: recipients.map((userId) => ({
        notificationId: notification.id,
        userId,
        channel: NotificationChannel.IN_APP,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
      })),
    });

    void this.pushService.sendToUsers(recipients, dto.title, dto.body, { type: dto.type });

    return notification;
  }

  /**
   * For callers inside another operation's transaction boundary — approving a
   * payment, publishing a period. Telling someone about a thing must never be
   * what stops the thing from happening, so a failure here is logged and
   * swallowed rather than surfaced as a failed API response.
   */
  async notifyQuietly(fn: () => Promise<unknown>, context: string) {
    try {
      await fn();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[notifications] ${context} failed:`, err);
    }
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
