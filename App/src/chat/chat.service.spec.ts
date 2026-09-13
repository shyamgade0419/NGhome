/**
 * Resident-to-resident chat, refresh-based: getOrCreateConversation must
 * never trust a client-supplied partner id (cross-society injection is
 * the exact bug class this whole app has been audited for), and every
 * conversation/message read must 404 — never a bare Forbidden — for
 * someone who isn't actually a participant, so probing a conversation id
 * that exists but isn't theirs reveals nothing.
 */

import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const SOCIETY_ID = 'society-a';
const CONVERSATION_ID = 'conv-1';
const USER_ID = 'resident-1';
const OTHER_ID = 'resident-2';

function makeService(opts: {
  membershipFindFirst?: unknown;
  conversationFindFirst?: unknown;
  conversationFindUnique?: unknown;
  participantFindFirst?: unknown;
} = {}) {
  const prisma = {
    societyMembership: {
      findFirst: jest.fn().mockResolvedValue('membershipFindFirst' in opts ? opts.membershipFindFirst : { id: 'm1' }),
    },
    conversation: {
      findFirst: jest.fn().mockResolvedValue('conversationFindFirst' in opts ? opts.conversationFindFirst : null),
      findUnique: jest.fn().mockResolvedValue(
        'conversationFindUnique' in opts
          ? opts.conversationFindUnique
          : { id: CONVERSATION_ID, participants: [{ userId: USER_ID, user: { id: USER_ID } }, { userId: OTHER_ID, user: { id: OTHER_ID, firstName: 'Priya' } }] },
      ),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: CONVERSATION_ID, ...data })),
      update: jest.fn().mockResolvedValue({}),
    },
    conversationParticipant: {
      findFirst: jest.fn().mockResolvedValue('participantFindFirst' in opts ? opts.participantFindFirst : { id: 'p1', userId: USER_ID }),
      findMany: jest.fn().mockResolvedValue([{ userId: OTHER_ID }]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    directMessage: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'msg-1', sender: { firstName: 'Asha' }, ...data })),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  } as unknown as PrismaService;

  const notifications = {
    sendToUsers: jest.fn().mockResolvedValue(null),
    notifyQuietly: jest.fn(async (fn: () => Promise<unknown>) => { await fn(); }),
  } as unknown as NotificationsService;

  return { service: new ChatService(prisma, notifications), prisma, notifications };
}

describe('ChatService.getOrCreateConversation', () => {
  it('refuses starting a conversation with yourself', async () => {
    const { service } = makeService();
    await expect(service.getOrCreateConversation(SOCIETY_ID, USER_ID, USER_ID)).rejects.toThrow(BadRequestException);
  });

  it("refuses a partner who isn't an active member of this society — never trusts the client-supplied id", async () => {
    const { service, prisma } = makeService({ membershipFindFirst: null });
    await expect(
      service.getOrCreateConversation(SOCIETY_ID, USER_ID, 'not-a-member'),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('creates a new conversation when none exists yet between these two people', async () => {
    const { service, prisma } = makeService({ conversationFindFirst: null });
    await service.getOrCreateConversation(SOCIETY_ID, USER_ID, OTHER_ID);
    expect(prisma.conversation.create).toHaveBeenCalledWith({
      data: { societyId: SOCIETY_ID, participants: { create: [{ userId: USER_ID }, { userId: OTHER_ID }] } },
    });
  });

  it('returns the existing 1:1 conversation instead of creating a duplicate', async () => {
    const { service, prisma } = makeService({
      conversationFindFirst: {
        id: CONVERSATION_ID,
        participants: [{ userId: USER_ID }, { userId: OTHER_ID }],
      },
    });
    await service.getOrCreateConversation(SOCIETY_ID, USER_ID, OTHER_ID);
    expect(prisma.conversation.create).not.toHaveBeenCalled();
  });

  it('creates a fresh conversation rather than reusing a 3+ participant group match', async () => {
    const { service, prisma } = makeService({
      conversationFindFirst: {
        id: 'group-conv',
        participants: [{ userId: USER_ID }, { userId: OTHER_ID }, { userId: 'third-party' }],
      },
    });
    await service.getOrCreateConversation(SOCIETY_ID, USER_ID, OTHER_ID);
    expect(prisma.conversation.create).toHaveBeenCalled();
  });
});

describe('ChatService — participant-only access', () => {
  it('listMessages 404s for someone who is not a participant, without leaking existence', async () => {
    const { service, prisma } = makeService({ participantFindFirst: null });
    await expect(service.listMessages(SOCIETY_ID, USER_ID, CONVERSATION_ID, 1, 30)).rejects.toThrow(NotFoundException);
    expect(prisma.directMessage.findMany).not.toHaveBeenCalled();
  });

  it('sendMessage 404s for a non-participant, without creating a message', async () => {
    const { service, prisma } = makeService({ participantFindFirst: null });
    await expect(
      service.sendMessage(SOCIETY_ID, USER_ID, CONVERSATION_ID, { body: 'hi' } as any),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.directMessage.create).not.toHaveBeenCalled();
  });

  it('a genuine participant can send a message, which notifies every OTHER participant', async () => {
    const { service, prisma, notifications } = makeService();
    await service.sendMessage(SOCIETY_ID, USER_ID, CONVERSATION_ID, { body: '  Hello!  ' } as any);

    expect(prisma.directMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { conversationId: CONVERSATION_ID, senderId: USER_ID, body: 'Hello!' } }),
    );
    expect(notifications.sendToUsers).toHaveBeenCalledWith(
      SOCIETY_ID, [OTHER_ID], expect.objectContaining({ type: 'DIRECT_MESSAGE' }),
    );
  });

  it('bumps the conversation updatedAt so it sorts to the top of the inbox', async () => {
    const { service, prisma } = makeService();
    await service.sendMessage(SOCIETY_ID, USER_ID, CONVERSATION_ID, { body: 'hi' } as any);
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: CONVERSATION_ID } }),
    );
  });

  it('markRead 404s for a non-participant and never writes', async () => {
    const { service, prisma } = makeService();
    (prisma.conversationParticipant.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(service.markRead(SOCIETY_ID, USER_ID, CONVERSATION_ID)).rejects.toThrow(NotFoundException);
  });
});

describe('ChatService.listConversations — unread flag', () => {
  function makeListPrisma(row: any) {
    return {
      conversationParticipant: { findMany: jest.fn().mockResolvedValue([row]) },
    } as unknown as PrismaService;
  }

  it('flags unread when the last message is from the other participant and postdates lastReadAt', async () => {
    const prisma = makeListPrisma({
      lastReadAt: new Date('2026-01-01'),
      conversation: {
        id: CONVERSATION_ID,
        updatedAt: new Date('2026-01-02'),
        participants: [{ userId: USER_ID, user: {} }, { userId: OTHER_ID, user: { firstName: 'Priya' } }],
        messages: [{ senderId: OTHER_ID, createdAt: new Date('2026-01-02'), body: 'hey' }],
      },
    });
    const service = new ChatService(prisma, {} as NotificationsService);
    const [result] = await service.listConversations(SOCIETY_ID, USER_ID);
    expect(result.hasUnread).toBe(true);
  });

  it("never flags unread for the caller's own last message", async () => {
    const prisma = makeListPrisma({
      lastReadAt: new Date('2026-01-01'),
      conversation: {
        id: CONVERSATION_ID,
        updatedAt: new Date('2026-01-02'),
        participants: [{ userId: USER_ID, user: {} }, { userId: OTHER_ID, user: {} }],
        messages: [{ senderId: USER_ID, createdAt: new Date('2026-01-02'), body: 'hey' }],
      },
    });
    const service = new ChatService(prisma, {} as NotificationsService);
    const [result] = await service.listConversations(SOCIETY_ID, USER_ID);
    expect(result.hasUnread).toBe(false);
  });

  it('does not flag unread once the message predates lastReadAt', async () => {
    const prisma = makeListPrisma({
      lastReadAt: new Date('2026-01-03'),
      conversation: {
        id: CONVERSATION_ID,
        updatedAt: new Date('2026-01-02'),
        participants: [{ userId: USER_ID, user: {} }, { userId: OTHER_ID, user: {} }],
        messages: [{ senderId: OTHER_ID, createdAt: new Date('2026-01-02'), body: 'hey' }],
      },
    });
    const service = new ChatService(prisma, {} as NotificationsService);
    const [result] = await service.listConversations(SOCIETY_ID, USER_ID);
    expect(result.hasUnread).toBe(false);
  });
});
