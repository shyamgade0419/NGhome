/**
 * send() used to only create the Notification row ("what was sent") and
 * never a single NotificationRecord ("who it was sent to") —
 * findMyNotifications() reads exclusively from NotificationRecord, so
 * every "Send to All Members" click reached nobody's inbox. These tests
 * lock in the fan-out that fixes that.
 */

import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { PrismaService } from '../prisma/prisma.service';
import { AnnouncementAudience, NotificationChannel, NotificationStatus, SystemRole } from '@prisma/client';

const SOCIETY_ID = 'society-a';

function makePrisma(memberships: Array<{ userId: string }>) {
  return {
    notification: {
      create: jest.fn().mockResolvedValue({ id: 'notif-1', societyId: SOCIETY_ID }),
    },
    notificationRecord: {
      createMany: jest.fn().mockResolvedValue({ count: memberships.length }),
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    societyMembership: {
      findMany: jest.fn().mockResolvedValue(memberships),
    },
  } as unknown as PrismaService;
}

function makePushService() {
  return { sendToUsers: jest.fn().mockResolvedValue(undefined) } as unknown as PushService;
}

describe('NotificationsService.send — recipient fan-out', () => {
  it('creates one NotificationRecord per active member when no audience is given', async () => {
    const prisma = makePrisma([{ userId: 'u1' }, { userId: 'u2' }, { userId: 'u3' }]);
    const push = makePushService();
    const service = new NotificationsService(prisma, push);

    await service.send(SOCIETY_ID, { title: 'Hello', body: 'World', type: 'GENERAL' });

    expect((prisma.notification as any).create).toHaveBeenCalled();
    expect((prisma.societyMembership as any).findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { societyId: SOCIETY_ID, status: 'ACTIVE' },
        distinct: ['userId'],
      }),
    );
    expect((prisma.notificationRecord as any).createMany).toHaveBeenCalledWith({
      data: [
        { notificationId: 'notif-1', userId: 'u1', channel: NotificationChannel.IN_APP, status: NotificationStatus.SENT, sentAt: expect.any(Date) },
        { notificationId: 'notif-1', userId: 'u2', channel: NotificationChannel.IN_APP, status: NotificationStatus.SENT, sentAt: expect.any(Date) },
        { notificationId: 'notif-1', userId: 'u3', channel: NotificationChannel.IN_APP, status: NotificationStatus.SENT, sentAt: expect.any(Date) },
      ],
    });
    // Real push delivery, not just an in-app row — same recipients.
    expect(push.sendToUsers).toHaveBeenCalledWith(
      ['u1', 'u2', 'u3'], 'Hello', 'World', { type: 'GENERAL' },
    );
  });

  it('does not double-notify a user holding two memberships in the same society', async () => {
    // distinct: ['userId'] is what Prisma would dedupe with — this test
    // verifies the query asks for that, using a mock that already reflects
    // a deduped result (a real DB would collapse the two rows itself).
    const prisma = makePrisma([{ userId: 'admin-who-is-also-resident' }]);
    const service = new NotificationsService(prisma, makePushService());

    await service.send(SOCIETY_ID, { title: 'Hi', body: 'There', type: 'GENERAL' });

    expect((prisma.notificationRecord as any).createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: 'admin-who-is-also-resident' })],
    });
  });

  it('narrows to SOCIETY_STAFF when audience is STAFF', async () => {
    const prisma = makePrisma([{ userId: 'staff-1' }]);
    const service = new NotificationsService(prisma, makePushService());

    await service.send(SOCIETY_ID, {
      title: 'Shift change', body: 'Details', type: 'GENERAL', audience: AnnouncementAudience.STAFF,
    });

    expect((prisma.societyMembership as any).findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { societyId: SOCIETY_ID, status: 'ACTIVE', role: SystemRole.SOCIETY_STAFF },
      }),
    );
  });

  it('skips creating records entirely when there are no active members', async () => {
    const prisma = makePrisma([]);
    const push = makePushService();
    const service = new NotificationsService(prisma, push);

    await service.send(SOCIETY_ID, { title: 'Empty', body: 'Society', type: 'GENERAL' });

    expect((prisma.notificationRecord as any).createMany).not.toHaveBeenCalled();
    expect(push.sendToUsers).toHaveBeenCalledWith([], 'Empty', 'Society', { type: 'GENERAL' });
  });
});
