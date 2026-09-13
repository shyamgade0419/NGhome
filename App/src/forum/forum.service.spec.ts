/**
 * Community forum: any active member can start a topic and reply; pin/lock
 * are moderation-only (enforced by the controller's RolesGuard, re-checked
 * here for tenant scoping); a topic can be removed by its own author or a
 * moderator, never by an unrelated resident.
 */

import { NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { ForumService } from './forum.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const SOCIETY_ID = 'society-a';
const TOPIC_ID = 'topic-1';
const AUTHOR_ID = 'resident-1';
const OTHER_ID = 'resident-2';

function makeTopic(overrides: Record<string, unknown> = {}) {
  return {
    id: TOPIC_ID,
    societyId: SOCIETY_ID,
    createdById: AUTHOR_ID,
    title: 'Gym equipment vote',
    body: 'Should we get a new treadmill?',
    isPinned: false,
    isLocked: false,
    ...overrides,
  };
}

function makeService(topic: unknown = makeTopic(), opts: { updateManyCount?: number } = {}) {
  const prisma = {
    forumTopic: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: TOPIC_ID, ...data })),
      findFirst: jest.fn().mockResolvedValue(topic),
      findMany: jest.fn().mockResolvedValue(topic ? [topic] : []),
      count: jest.fn().mockResolvedValue(topic ? 1 : 0),
      updateMany: jest.fn().mockResolvedValue({ count: opts.updateManyCount ?? (topic ? 1 : 0) }),
      delete: jest.fn().mockResolvedValue(topic),
    },
    forumReply: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'reply-1', ...data })),
    },
  } as unknown as PrismaService;

  const notifications = {
    sendToUsers: jest.fn().mockResolvedValue(null),
    notifyQuietly: jest.fn(async (fn: () => Promise<unknown>) => { await fn(); }),
  } as unknown as NotificationsService;

  return { service: new ForumService(prisma, notifications), prisma, notifications };
}

describe('ForumService.createTopic', () => {
  it('trims title and body and scopes to the caller\'s society', async () => {
    const { service, prisma } = makeService();
    await service.createTopic(SOCIETY_ID, AUTHOR_ID, { title: '  Gym vote  ', body: '  Thoughts?  ' } as any);

    const [createArg] = (prisma.forumTopic.create as jest.Mock).mock.calls[0];
    expect(createArg.data).toMatchObject({
      societyId: SOCIETY_ID, createdById: AUTHOR_ID, title: 'Gym vote', body: 'Thoughts?',
    });
  });
});

describe('ForumService.findOne — tenant isolation', () => {
  it('returns the topic with replies scoped to this society', async () => {
    const { service, prisma } = makeService();
    await service.findOne(SOCIETY_ID, TOPIC_ID);
    expect((prisma.forumTopic.findFirst as jest.Mock).mock.calls[0][0].where).toEqual({ id: TOPIC_ID, societyId: SOCIETY_ID });
  });

  it("throws NotFoundException for a topic belonging to a different society", async () => {
    const { service } = makeService(null);
    await expect(service.findOne(SOCIETY_ID, TOPIC_ID)).rejects.toThrow(NotFoundException);
  });
});

describe('ForumService.addReply', () => {
  it('creates a reply and notifies the topic creator, not the replier', async () => {
    const { service, prisma, notifications } = makeService(makeTopic({ createdById: AUTHOR_ID }));
    await service.addReply(SOCIETY_ID, TOPIC_ID, OTHER_ID, { body: 'Yes please!' } as any);

    expect(prisma.forumReply.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { topicId: TOPIC_ID, authorId: OTHER_ID, body: 'Yes please!' } }),
    );
    expect(notifications.sendToUsers).toHaveBeenCalledWith(
      SOCIETY_ID, [AUTHOR_ID], expect.objectContaining({ type: 'FORUM_REPLY' }),
    );
  });

  it('never notifies when the topic creator replies to their own topic', async () => {
    const { service, notifications } = makeService(makeTopic({ createdById: AUTHOR_ID }));
    await service.addReply(SOCIETY_ID, TOPIC_ID, AUTHOR_ID, { body: 'Update: done!' } as any);
    expect(notifications.sendToUsers).not.toHaveBeenCalled();
  });

  it('refuses a reply on a locked topic, without creating one', async () => {
    const { service, prisma } = makeService(makeTopic({ isLocked: true }));
    await expect(
      service.addReply(SOCIETY_ID, TOPIC_ID, OTHER_ID, { body: 'Too late?' } as any),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.forumReply.create).not.toHaveBeenCalled();
  });

  it('refuses a reply on a topic from another society', async () => {
    const { service } = makeService(null);
    await expect(
      service.addReply(SOCIETY_ID, TOPIC_ID, OTHER_ID, { body: 'x' } as any),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('ForumService — moderation (pin/lock)', () => {
  it('setPinned scopes the update to this society and returns the refreshed topic', async () => {
    const { service, prisma } = makeService();
    await service.setPinned(SOCIETY_ID, TOPIC_ID, true);
    expect((prisma.forumTopic.updateMany as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { id: TOPIC_ID, societyId: SOCIETY_ID },
      data: { isPinned: true },
    });
  });

  it('setPinned/setLocked throw NotFoundException for a topic outside this society', async () => {
    const { service } = makeService(makeTopic(), { updateManyCount: 0 });
    await expect(service.setPinned(SOCIETY_ID, TOPIC_ID, true)).rejects.toThrow(NotFoundException);
    await expect(service.setLocked(SOCIETY_ID, TOPIC_ID, true)).rejects.toThrow(NotFoundException);
  });
});

describe('ForumService.remove — who can delete a topic', () => {
  it('lets the original author remove their own topic', async () => {
    const { service, prisma } = makeService(makeTopic({ createdById: AUTHOR_ID }));
    await service.remove(SOCIETY_ID, TOPIC_ID, { id: AUTHOR_ID, isModerator: false });
    expect(prisma.forumTopic.delete).toHaveBeenCalledWith({ where: { id: TOPIC_ID } });
  });

  it('lets a moderator remove someone else\'s topic', async () => {
    const { service, prisma } = makeService(makeTopic({ createdById: AUTHOR_ID }));
    await service.remove(SOCIETY_ID, TOPIC_ID, { id: 'admin-1', isModerator: true });
    expect(prisma.forumTopic.delete).toHaveBeenCalled();
  });

  it('refuses an unrelated resident who is neither the author nor a moderator', async () => {
    const { service, prisma } = makeService(makeTopic({ createdById: AUTHOR_ID }));
    await expect(
      service.remove(SOCIETY_ID, TOPIC_ID, { id: OTHER_ID, isModerator: false }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.forumTopic.delete).not.toHaveBeenCalled();
  });

  it('throws NotFoundException for a topic outside this society, before any permission check', async () => {
    const { service } = makeService(null);
    await expect(
      service.remove(SOCIETY_ID, TOPIC_ID, { id: AUTHOR_ID, isModerator: true }),
    ).rejects.toThrow(NotFoundException);
  });
});
