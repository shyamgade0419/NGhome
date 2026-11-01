/**
 * PushService is what actually turned "wrote a NotificationRecord" into
 * "the phone buzzed" — nothing did that before. These tests cover the
 * registration upsert (why it's keyed by token, not by user) and that a
 * failed send never throws (NotificationsService.send must not fail just
 * because a push happened to fail).
 */

import { PushService } from './push.service';
import { PrismaService } from '../prisma/prisma.service';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.restoreAllMocks();
});

function makePrisma(tokens: Array<{ token: string; userId: string }> = []) {
  return {
    pushToken: {
      upsert: jest.fn().mockResolvedValue({ id: 'pt-1' }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue(tokens),
    },
  } as unknown as PrismaService;
}

describe('PushService.registerToken', () => {
  it('upserts by token so the same device re-registering re-points at the current user', async () => {
    const prisma = makePrisma();
    const service = new PushService(prisma);

    await service.registerToken('user-2', 'ExponentPushToken[abc]', 'android');

    expect((prisma.pushToken as any).upsert).toHaveBeenCalledWith({
      where: { token: 'ExponentPushToken[abc]' },
      create: { userId: 'user-2', token: 'ExponentPushToken[abc]', platform: 'android' },
      update: { userId: 'user-2', platform: 'android' },
    });
  });
});

describe('PushService.sendToUsers', () => {
  it('does nothing (no network call) when there are no recipient user ids', async () => {
    const prisma = makePrisma();
    global.fetch = jest.fn();
    const service = new PushService(prisma);

    await service.sendToUsers([], 'Title', 'Body');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('does nothing when recipients exist but none have a registered device', async () => {
    const prisma = makePrisma([]);
    global.fetch = jest.fn();
    const service = new PushService(prisma);

    await service.sendToUsers(['user-1'], 'Title', 'Body');

    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends one Expo push message per registered token', async () => {
    const prisma = makePrisma([
      { token: 'ExponentPushToken[a]', userId: 'user-1' },
      { token: 'ExponentPushToken[b]', userId: 'user-1' },
    ]);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: 'ok' }, { status: 'ok' }] }),
    });
    global.fetch = fetchMock as any;
    const service = new PushService(prisma);

    await service.sendToUsers(['user-1'], 'Hello', 'World', { type: 'GENERAL' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body).toEqual([
      { to: 'ExponentPushToken[a]', title: 'Hello', body: 'World', data: { type: 'GENERAL' }, sound: 'default', priority: 'high', channelId: 'alerts' },
      { to: 'ExponentPushToken[b]', title: 'Hello', body: 'World', data: { type: 'GENERAL' }, sound: 'default', priority: 'high', channelId: 'alerts' },
    ]);
  });

  it('removes a token that Expo reports as DeviceNotRegistered', async () => {
    const prisma = makePrisma([{ token: 'ExponentPushToken[stale]', userId: 'user-1' }]);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }),
    }) as any;
    const service = new PushService(prisma);

    await service.sendToUsers(['user-1'], 'Hello', 'World');

    expect((prisma.pushToken as any).deleteMany).toHaveBeenCalledWith({
      where: { token: { in: ['ExponentPushToken[stale]'] } },
    });
  });

  it('never throws — a failed push must not fail the notification send that triggered it', async () => {
    const prisma = makePrisma([{ token: 'ExponentPushToken[a]', userId: 'user-1' }]);
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as any;
    const service = new PushService(prisma);

    await expect(service.sendToUsers(['user-1'], 'Hello', 'World')).resolves.toBeUndefined();
  });

  describe('the test alert', () => {
    it('says no phone is registered when the user has none', async () => {
      global.fetch = jest.fn() as any;
      const service = new PushService(makePrisma([]));
      await expect(service.sendTest('user-1')).resolves.toEqual({ devices: 0, accepted: 0, problems: [] });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('counts the phones Expo accepted', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [{ status: 'ok' }] }) }) as any;
      const service = new PushService(makePrisma([{ token: 'ExponentPushToken[a]', userId: 'user-1' }]));
      await expect(service.sendTest('user-1')).resolves.toEqual({ devices: 1, accepted: 1, problems: [] });
    });

    it('reports why Expo refused — missing Firebase credentials is the usual reason', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ status: 'error', message: 'Unable to retrieve the FCM server key', details: { error: 'InvalidCredentials' } }] }),
      }) as any;
      const service = new PushService(makePrisma([{ token: 'ExponentPushToken[a]', userId: 'user-1' }]));
      const out = await service.sendTest('user-1');
      expect(out.accepted).toBe(0);
      expect(out.problems[0]).toContain('InvalidCredentials');
    });

    it('reports an unreachable push service instead of throwing', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as any;
      const service = new PushService(makePrisma([{ token: 'ExponentPushToken[a]', userId: 'user-1' }]));
      const out = await service.sendTest('user-1');
      expect(out.accepted).toBe(0);
      expect(out.problems[0]).toContain('network down');
    });
  });
});
