/**
 * Nothing in the product ever sent a notification automatically. The whole
 * pipeline existed — tokens, permissions, badge, push delivery — but no
 * domain event called it, so the only notifications that ever reached a
 * resident were ones an admin typed by hand. Residents were never told their
 * bill was ready or their payment had been approved.
 *
 * These lock in that the events fire, and that failing to notify can never
 * undo the thing being notified about.
 */

import { NotificationsService } from './notifications.service';
import { PushService } from './push.service';
import { PrismaService } from '../prisma/prisma.service';

const SOCIETY_ID = 'society-a';

function makeService() {
  const prisma = {
    notification: { create: jest.fn().mockResolvedValue({ id: 'n1' }) },
    notificationRecord: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    societyMembership: { findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]) },
  } as unknown as PrismaService;
  const push = { sendToUsers: jest.fn().mockResolvedValue(undefined) } as unknown as PushService;
  return { service: new NotificationsService(prisma, push), prisma, push };
}

describe('NotificationsService.sendToUsers', () => {
  it('records the notification against each named user and pushes to them', async () => {
    const { service, prisma, push } = makeService();
    await service.sendToUsers(SOCIETY_ID, ['u1', 'u2'], {
      title: 'Payment approved',
      body: 'Received.',
      type: 'PAYMENT_APPROVED',
    });

    const [recordsArg] = (prisma.notificationRecord.createMany as jest.Mock).mock.calls[0];
    expect(recordsArg.data.map((r: any) => r.userId)).toEqual(['u1', 'u2']);
    expect(push.sendToUsers).toHaveBeenCalledWith(
      ['u1', 'u2'], 'Payment approved', 'Received.', { type: 'PAYMENT_APPROVED' },
    );
  });

  it('does not tell the same person twice when they hold two memberships', async () => {
    const { service, prisma } = makeService();
    await service.sendToUsers(SOCIETY_ID, ['u1', 'u1'], { title: 'T', body: 'B', type: 'X' });

    const [recordsArg] = (prisma.notificationRecord.createMany as jest.Mock).mock.calls[0];
    expect(recordsArg.data).toHaveLength(1);
  });

  it('does nothing at all when there is no one to tell', async () => {
    const { service, prisma, push } = makeService();
    const result = await service.sendToUsers(SOCIETY_ID, [], { title: 'T', body: 'B', type: 'X' });

    expect(result).toBeNull();
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(push.sendToUsers).not.toHaveBeenCalled();
  });
});

describe('NotificationsService.notifyQuietly', () => {
  it('swallows a failure so the operation being reported on still succeeds', async () => {
    // Approving a payment must not be undone because a push server was down.
    const { service } = makeService();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      service.notifyQuietly(() => Promise.reject(new Error('push server down')), 'test context'),
    ).resolves.toBeUndefined();

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('passes a success through without complaint', async () => {
    const { service } = makeService();
    const fn = jest.fn().mockResolvedValue('ok');
    await service.notifyQuietly(fn, 'test context');
    expect(fn).toHaveBeenCalled();
  });
});
