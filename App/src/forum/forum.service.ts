import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';
import { CreateForumTopicDto } from './dto/create-forum-topic.dto';
import { CreateForumReplyDto } from './dto/create-forum-reply.dto';

const AUTHOR_SELECT = { id: true, firstName: true, lastName: true } as const;

@Injectable()
export class ForumService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async createTopic(societyId: string, createdById: string, dto: CreateForumTopicDto) {
    return this.prisma.forumTopic.create({
      data: {
        societyId,
        createdById,
        title: dto.title.trim(),
        body: dto.body.trim(),
      },
      include: {
        createdBy: { select: AUTHOR_SELECT },
        _count: { select: { replies: true } },
      },
    });
  }

  async findAll(societyId: string, page: number, limit: number) {
    const { skip, take } = getPaginationParams({ page, limit });
    const where = { societyId };

    const [data, total] = await Promise.all([
      this.prisma.forumTopic.findMany({
        where,
        skip,
        take,
        // Pinned topics always float to the top, newest-first within each group.
        orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        include: {
          createdBy: { select: AUTHOR_SELECT },
          _count: { select: { replies: true } },
        },
      }),
      this.prisma.forumTopic.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(societyId: string, topicId: string) {
    const topic = await this.prisma.forumTopic.findFirst({
      where: { id: topicId, societyId },
      include: {
        createdBy: { select: AUTHOR_SELECT },
        replies: {
          orderBy: { createdAt: 'asc' },
          include: { author: { select: AUTHOR_SELECT } },
        },
      },
    });
    if (!topic) throw new NotFoundException('Topic not found');
    return topic;
  }

  async addReply(societyId: string, topicId: string, authorId: string, dto: CreateForumReplyDto) {
    // findFirst rather than a bare create — confirms the topic both exists
    // and belongs to the caller's own society before anything is written,
    // and gives us the current isLocked/createdById state to act on.
    const topic = await this.prisma.forumTopic.findFirst({ where: { id: topicId, societyId } });
    if (!topic) throw new NotFoundException('Topic not found');
    if (topic.isLocked) {
      throw new BadRequestException('This topic is locked and no longer accepting replies');
    }

    const reply = await this.prisma.forumReply.create({
      data: { topicId, authorId, body: dto.body.trim() },
      include: { author: { select: AUTHOR_SELECT } },
    });

    // Tell the person who started the discussion, not the replier — the
    // same "notify the other side" pattern Helpdesk already uses, so
    // someone doesn't have to keep reopening the app to see if anyone
    // answered their topic.
    if (topic.createdById !== authorId) {
      await this.notifications.notifyQuietly(
        () =>
          this.notifications.sendToUsers(societyId, [topic.createdById], {
            title: `New reply on "${topic.title}"`,
            body: reply.body.length > 120 ? `${reply.body.slice(0, 117)}…` : reply.body,
            type: 'FORUM_REPLY',
            data: { topicId },
          }),
        `forum topic ${topicId} reply`,
      );
    }

    return reply;
  }

  /**
   * Pin/lock are moderation-only — the controller gates these behind
   * ADMIN/COMMITTEE_MEMBER roles, but the service re-checks the topic
   * belongs to this society regardless, the same tenant-scoping every
   * other mutation in this codebase applies before writing anything.
   */
  async setPinned(societyId: string, topicId: string, isPinned: boolean) {
    const result = await this.prisma.forumTopic.updateMany({
      where: { id: topicId, societyId },
      data: { isPinned },
    });
    if (result.count === 0) throw new NotFoundException('Topic not found');
    return this.findOne(societyId, topicId);
  }

  async setLocked(societyId: string, topicId: string, isLocked: boolean) {
    const result = await this.prisma.forumTopic.updateMany({
      where: { id: topicId, societyId },
      data: { isLocked },
    });
    if (result.count === 0) throw new NotFoundException('Topic not found');
    return this.findOne(societyId, topicId);
  }

  /**
   * Moderation delete (admin/committee) or the original author removing
   * their own topic — the same "raiser or reviewer" shape Helpdesk uses
   * for who can act on a thread.
   */
  async remove(societyId: string, topicId: string, actor: { id: string; isModerator: boolean }) {
    const topic = await this.prisma.forumTopic.findFirst({ where: { id: topicId, societyId } });
    if (!topic) throw new NotFoundException('Topic not found');
    if (!actor.isModerator && topic.createdById !== actor.id) {
      throw new ForbiddenException('You can only remove your own topics');
    }
    await this.prisma.forumTopic.delete({ where: { id: topicId } });
  }
}
