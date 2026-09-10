import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MaintenanceRequestStatus, SystemRole } from '@prisma/client';
import {
  CreateMaintenanceRequestDto,
  UpdateRequestStatusDto,
  CreateRequestCommentDto,
} from './dto/create-request.dto';

/** Just what access decisions need — the controller builds this from the
 *  authenticated user, so the service never trusts ids from the request. */
export interface HelpdeskViewer {
  id: string;
  currentRole?: string | null;
  isPlatformAdmin?: boolean;
}

export function isHelpdeskStaff(viewer: HelpdeskViewer): boolean {
  return !!viewer.isPlatformAdmin || viewer.currentRole !== 'RESIDENT';
}

@Injectable()
export class HelpdeskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(societyId: string, residentId: string, dto: CreateMaintenanceRequestDto) {
    return this.prisma.maintenanceRequest.create({
      data: {
        societyId,
        residentId,
        flatId: dto.flatId,
        title: dto.title,
        description: dto.description,
        category: dto.category ?? 'OTHER',
        priority: dto.priority ?? 'MEDIUM',
      },
      include: {
        resident: { select: { id: true, firstName: true, lastName: true, email: true } },
        flat: { select: { id: true, unitNumber: true, flatCode: true } },
      },
    });
  }

  async findAll(
    societyId: string,
    options: {
      forResident?: boolean;
      residentId?: string;
      status?: MaintenanceRequestStatus;
      category?: string;
      page?: number;
      limit?: number;
    } = {},
  ) {
    const { forResident, residentId, status, category, page = 1, limit = 50 } = options;
    const skip = (page - 1) * limit;

    const where: any = { societyId };
    if (forResident && residentId) where.residentId = residentId;
    if (status) where.status = status;
    if (category) where.category = category;

    const [data, total] = await Promise.all([
      this.prisma.maintenanceRequest.findMany({
        where,
        skip,
        take: limit,
        orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
        include: {
          resident: { select: { id: true, firstName: true, lastName: true } },
          flat: { select: { id: true, unitNumber: true, flatCode: true, buildingId: true } },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.maintenanceRequest.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(societyId: string, id: string, viewer?: HelpdeskViewer) {
    const req = await this.prisma.maintenanceRequest.findFirst({
      where: { id, societyId },
      include: {
        resident: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        flat: { select: { id: true, unitNumber: true, flatCode: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!req) throw new NotFoundException('Maintenance request not found');
    if (viewer) this.assertCanAccess(req, viewer);
    return req;
  }

  /**
   * A resident may only see and reply to requests they raised; staff may see
   * any in their society.
   *
   * GET /helpdesk/:id used to have no such check. The list was scoped to the
   * caller, but the single-item route returned any request in the society to
   * any member who asked for its id — including the raiser's email and phone.
   * A reply thread built on that route would have exposed whole conversations
   * the same way, so the check lives here and every per-request route uses it.
   *
   * "Staff" mirrors the rule findAll already applies — anyone whose current
   * role is not RESIDENT — so a request someone can see in the list is exactly
   * a request they can open.
   *
   * Throws NotFound rather than Forbidden for a resident's attempt on someone
   * else's request: confirming the id exists would itself be the leak.
   */
  private assertCanAccess(req: { residentId: string }, viewer: HelpdeskViewer) {
    if (isHelpdeskStaff(viewer)) return;
    if (req.residentId !== viewer.id) {
      throw new NotFoundException('Maintenance request not found');
    }
  }

  async listComments(societyId: string, requestId: string, viewer: HelpdeskViewer) {
    const req = await this.findOne(societyId, requestId, viewer);

    const comments = await this.prisma.maintenanceRequestComment.findMany({
      where: { requestId },
      orderBy: { createdAt: 'asc' },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });

    // Derived rather than stored: whether a line came from the person who
    // raised the ticket is what both screens need to lay out the thread, and
    // it cannot drift from the truth if it is computed.
    return comments.map((c) => ({ ...c, isFromResident: c.authorId === req.residentId }));
  }

  async addComment(
    societyId: string,
    requestId: string,
    viewer: HelpdeskViewer,
    dto: CreateRequestCommentDto,
  ) {
    const req = await this.findOne(societyId, requestId, viewer);

    const body = dto.body.trim();
    if (!body) throw new BadRequestException('Reply cannot be empty');
    if (req.status === 'CLOSED') {
      throw new BadRequestException(
        'This request is closed. Raise a new one if the problem has come back.',
      );
    }

    const comment = await this.prisma.maintenanceRequestComment.create({
      data: { requestId, authorId: viewer.id, body },
      include: { author: { select: { id: true, firstName: true, lastName: true } } },
    });

    const fromResident = viewer.id === req.residentId;
    const preview = body.length > 120 ? `${body.slice(0, 117)}…` : body;

    // Tell the other side, never the author. A resident's reply goes to the
    // assigned staff member if there is one, otherwise to the society admins —
    // someone has to actually see it, and "everyone" would be noise.
    await this.notifications.notifyQuietly(async () => {
      const recipients = fromResident
        ? req.assignedToId
          ? [req.assignedToId]
          : await this.societyAdminIds(societyId)
        : [req.residentId];

      await this.notifications.sendToUsers(
        societyId,
        recipients.filter((id) => id !== viewer.id),
        {
          title: fromResident ? `Reply on "${req.title}"` : `Update on your request`,
          body: fromResident ? preview : `"${req.title}" — ${preview}`,
          type: 'HELPDESK_REPLY',
          data: { requestId },
        },
      );
    }, `helpdesk request ${requestId} reply`);

    return { ...comment, isFromResident: fromResident };
  }

  private async societyAdminIds(societyId: string): Promise<string[]> {
    const admins = await this.prisma.societyMembership.findMany({
      where: { societyId, status: 'ACTIVE', role: SystemRole.SOCIETY_ADMIN },
      select: { userId: true },
      distinct: ['userId'],
    });
    return admins.map((a) => a.userId);
  }

  async updateStatus(societyId: string, id: string, dto: UpdateRequestStatusDto) {
    await this.findOne(societyId, id);
    const resolvedAt =
      dto.status === 'RESOLVED' || dto.status === 'CLOSED' ? new Date() : undefined;

    const updated = await this.prisma.maintenanceRequest.update({
      where: { id },
      data: {
        status: dto.status as MaintenanceRequestStatus,
        adminNotes: dto.adminNotes,
        assignedToId: dto.assignedToId,
        ...(resolvedAt ? { resolvedAt } : {}),
      },
      include: {
        resident: { select: { id: true, firstName: true, lastName: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    // Tickets are one-way: a resident raises one and can only watch the
    // status. Until now nothing told them it had changed, so the only way to
    // find out was to keep reopening the app. adminNotes is included when
    // present because that is usually the actual answer to their question.
    await this.notifications.notifyQuietly(
      () =>
        this.notifications.sendToUsers(societyId, [updated.residentId], {
          title: `Your request is ${dto.status.toLowerCase().replace(/_/g, ' ')}`,
          body: dto.adminNotes?.trim()
            ? `"${updated.title}" — ${dto.adminNotes.trim()}`
            : `"${updated.title}" is now ${dto.status.toLowerCase().replace(/_/g, ' ')}.`,
          type: 'HELPDESK_UPDATED',
          data: { requestId: id, status: dto.status },
        }),
      `helpdesk request ${id} status change`,
    );

    return updated;
  }
}
