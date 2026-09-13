import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';
import { SendMessageDto } from './dto/send-message.dto';

const PARTICIPANT_SELECT = { id: true, firstName: true, lastName: true } as const;

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Refresh-based chat, not a live socket: a sent message is a normal row
   * the recipient's client picks up on its next poll of listMessages, with
   * a push notification (existing NotificationsService) telling them to
   * look. No new deployment infrastructure, no persistent connections to
   * manage — the same architecture every other feature in this app uses.
   */

  async getOrCreateConversation(societyId: string, userId: string, otherUserId: string) {
    if (userId === otherUserId) {
      throw new BadRequestException('Cannot start a conversation with yourself');
    }

    // Never trust a client-supplied id as a chat partner — confirm they're
    // a genuine active member of THIS society first, the same discipline
    // every other cross-entity reference in this codebase applies.
    const otherMembership = await this.prisma.societyMembership.findFirst({
      where: { societyId, userId: otherUserId, status: 'ACTIVE' },
    });
    if (!otherMembership) throw new NotFoundException('That resident is not part of this society');

    // Look for an existing 1:1 conversation between exactly these two
    // people. participants.length === 2 is what makes this "exactly these
    // two", not a future group conversation either of them also belongs
    // to. A genuinely simultaneous double-call from the same two users
    // could still create two separate conversations — a harmless
    // duplicate inbox entry, never a financial or security issue — rather
    // than something worth an atomic claim over a pair-of-users key.
    const existing = await this.prisma.conversation.findFirst({
      where: {
        societyId,
        AND: [
          { participants: { some: { userId } } },
          { participants: { some: { userId: otherUserId } } },
        ],
      },
      include: { participants: true },
    });
    if (existing && existing.participants.length === 2) {
      return this.hydrate(existing.id, userId);
    }

    const created = await this.prisma.conversation.create({
      data: { societyId, participants: { create: [{ userId }, { userId: otherUserId }] } },
    });
    return this.hydrate(created.id, userId);
  }

  async listConversations(societyId: string, userId: string) {
    const rows = await this.prisma.conversationParticipant.findMany({
      where: { userId, conversation: { societyId } },
      include: {
        conversation: {
          include: {
            participants: { include: { user: { select: PARTICIPANT_SELECT } } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
      orderBy: { conversation: { updatedAt: 'desc' } },
    });

    return rows.map((row) => {
      const other = row.conversation.participants.find((p) => p.userId !== userId)?.user ?? null;
      const lastMessage = row.conversation.messages[0] ?? null;
      // A simple has-unread flag, not a count: refresh-based chat doesn't
      // need per-message read receipts, just "does this need a look".
      const hasUnread = !!(
        lastMessage &&
        lastMessage.senderId !== userId &&
        (!row.lastReadAt || lastMessage.createdAt > row.lastReadAt)
      );

      return {
        conversationId: row.conversation.id,
        otherUser: other,
        lastMessage,
        hasUnread,
        updatedAt: row.conversation.updatedAt,
      };
    });
  }

  async listMessages(societyId: string, userId: string, conversationId: string, page: number, limit: number) {
    await this.assertParticipant(societyId, userId, conversationId);
    const { skip, take } = getPaginationParams({ page, limit });

    const [data, total] = await Promise.all([
      this.prisma.directMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { sender: { select: PARTICIPANT_SELECT } },
      }),
      this.prisma.directMessage.count({ where: { conversationId } }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async sendMessage(societyId: string, userId: string, conversationId: string, dto: SendMessageDto) {
    await this.assertParticipant(societyId, userId, conversationId);

    const message = await this.prisma.directMessage.create({
      data: { conversationId, senderId: userId, body: dto.body.trim() },
      include: { sender: { select: PARTICIPANT_SELECT } },
    });

    // Bumps the conversation to the top of both participants' inbox —
    // listConversations orders by this.
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    const others = await this.prisma.conversationParticipant.findMany({
      where: { conversationId, userId: { not: userId } },
      select: { userId: true },
    });
    if (others.length > 0) {
      await this.notifications.notifyQuietly(
        () =>
          this.notifications.sendToUsers(societyId, others.map((o) => o.userId), {
            title: `New message from ${message.sender.firstName}`,
            body: message.body.length > 120 ? `${message.body.slice(0, 117)}…` : message.body,
            type: 'DIRECT_MESSAGE',
            data: { conversationId },
          }),
        `direct message in conversation ${conversationId}`,
      );
    }

    return message;
  }

  async markRead(societyId: string, userId: string, conversationId: string) {
    const result = await this.prisma.conversationParticipant.updateMany({
      where: { conversationId, userId, conversation: { societyId } },
      data: { lastReadAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('Conversation not found');
  }

  private async hydrate(conversationId: string, userId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { participants: { include: { user: { select: PARTICIPANT_SELECT } } } },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const other = conversation.participants.find((p) => p.userId !== userId)?.user ?? null;
    return { conversationId: conversation.id, otherUser: other };
  }

  // Throws NotFoundException (never Forbidden) for a conversation that
  // exists but the caller isn't part of — confirming it exists at all
  // would itself be the leak, the same reasoning Helpdesk already applies
  // to a resident probing someone else's request by id.
  private async assertParticipant(societyId: string, userId: string, conversationId: string) {
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: { conversationId, userId, conversation: { societyId } },
    });
    if (!participant) throw new NotFoundException('Conversation not found');
  }
}
