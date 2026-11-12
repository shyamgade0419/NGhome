import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import { announcementNotice, eventReminder, meetingReminder } from './notification-content';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

/** The reminder goes out when the thing is between 22 and 24 hours away: once, a day before. */
const REMINDER_FROM_MS = 22 * HOUR_MS;
const REMINDER_TO_MS = 24 * HOUR_MS;
/** Something announced less than this long ago already told people; a reminder straight after would be a second alert. */
const RECENT_MS = 6 * HOUR_MS;
/** A scheduled announcement missed for longer than this (the server was down) is not sent late: it would be stale news. */
const ANNOUNCEMENT_GRACE_MS = 2 * 24 * HOUR_MS;

export interface SchedulerResult {
  announcements: number;
  meetingReminders: number;
  eventReminders: number;
}

/**
 * Sends the notifications that depend on the clock:
 *  - an announcement scheduled for later (published with a future publish time), when that time arrives;
 *  - a reminder the day before each meeting and each event.
 *
 * It runs by itself every 15 minutes (and once shortly after start-up). Running it twice, or on two servers at once, is
 * harmless: each thing is checked against the notifications already sent for it before it is sent.
 */
@Injectable()
export class NotificationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationSchedulerService.name);
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  onModuleInit() {
    // Tests drive it directly; a timer would only keep them from exiting.
    if (process.env.NODE_ENV === 'test' || process.env.NOTIFICATION_JOB === 'off') return;
    const run = () => void this.run().catch((e) => this.logger.error(`Notification run failed: ${e instanceof Error ? e.message : e}`));
    this.first = setTimeout(run, 90_000);
    this.timer = setInterval(run, 15 * MINUTE_MS);
    this.first.unref();
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.first) clearTimeout(this.first);
  }

  async run(now = new Date()): Promise<SchedulerResult> {
    const result: SchedulerResult = { announcements: 0, meetingReminders: 0, eventReminders: 0 };
    // One failing kind must not stop the others.
    for (const [key, job] of [
      ['announcements', () => this.dueAnnouncements(now)],
      ['meetingReminders', () => this.meetingReminders(now)],
      ['eventReminders', () => this.eventReminders(now)],
    ] as const) {
      try {
        result[key] = await job();
      } catch (e) {
        this.logger.error(`${key} failed: ${e instanceof Error ? e.message : e}`);
      }
    }
    return result;
  }

  /** Announcements published for a time that has now come, which nobody has been told about yet. */
  async dueAnnouncements(now: Date): Promise<number> {
    const due = await this.prisma.announcement.findMany({
      where: {
        isPublished: true,
        publishAt: { not: null, lte: now, gte: new Date(now.getTime() - ANNOUNCEMENT_GRACE_MS) },
        OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
      },
    });
    let sent = 0;
    for (const a of due) {
      if (await this.notifications.alreadySent(a.societyId, 'ANNOUNCEMENT', 'announcementId', a.id)) continue;
      await this.notifications.send(
        a.societyId,
        { ...announcementNotice(a), audience: a.audience, audienceConfig: a.audienceConfig as { buildingIds?: string[]; flatIds?: string[] } },
        { excludeUserId: a.createdById },
      );
      sent += 1;
    }
    return sent;
  }

  /** Meetings 22 to 24 hours away, created at least 6 hours ago, not yet reminded. */
  async meetingReminders(now: Date): Promise<number> {
    const meetings = await this.prisma.meeting.findMany({
      where: {
        meetingDate: { gt: new Date(now.getTime() + REMINDER_FROM_MS), lte: new Date(now.getTime() + REMINDER_TO_MS) },
        createdAt: { lte: new Date(now.getTime() - RECENT_MS) },
      },
    });
    let sent = 0;
    for (const m of meetings) {
      if (await this.notifications.alreadySent(m.societyId, 'MEETING_REMINDER', 'meetingId', m.id)) continue;
      await this.notifications.send(m.societyId, meetingReminder(m));
      sent += 1;
    }
    return sent;
  }

  /** Planned events, open to residents, 22 to 24 hours away, created at least 6 hours ago, not yet reminded. */
  async eventReminders(now: Date): Promise<number> {
    const events = await this.prisma.event.findMany({
      where: {
        status: 'PLANNED',
        isVisibleToResidents: true,
        eventDate: { gt: new Date(now.getTime() + REMINDER_FROM_MS), lte: new Date(now.getTime() + REMINDER_TO_MS) },
        createdAt: { lte: new Date(now.getTime() - RECENT_MS) },
      },
    });
    let sent = 0;
    for (const e of events) {
      if (await this.notifications.alreadySent(e.societyId, 'EVENT_REMINDER', 'eventId', e.id)) continue;
      await this.notifications.send(e.societyId, eventReminder(e));
      sent += 1;
    }
    return sent;
  }
}
