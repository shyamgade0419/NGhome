import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';
import { CreateMeetingDto } from './dto/create-meeting.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { meetingNotice } from '../notifications/notification-content';
import { WhatsappService } from '../whatsapp/whatsapp.service';
export { CreateMeetingDto } from './dto/create-meeting.dto';

@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly whatsapp?: WhatsappService,
  ) {}

  async create(societyId: string, createdById: string, dto: CreateMeetingDto) {
    const meeting = await this.prisma.meeting.create({
      data: {
        societyId,
        createdById,
        title: dto.title,
        meetingDate: new Date(dto.meetingDate),
        location: dto.location,
        agenda: dto.agenda,
      },
    });
    // Everyone is told when and where; the details are in the alert itself, so it does not depend on the meeting being open
    // to residents in the app (that only happens once its minutes are published).
    if (this.notifications && meeting.meetingDate > new Date()) {
      await this.notifications.notifyQuietly(
        () => this.notifications!.send(societyId, meetingNotice(meeting), { excludeUserId: createdById }),
        `meeting ${meeting.id} scheduled`,
      );
    }
    // And on WhatsApp, for a society that has switched meeting and event messages on. Never fails the save.
    if (this.whatsapp && meeting.meetingDate > new Date()) {
      await this.whatsapp
        .enqueueNotice(societyId, { type: 'MEETING', stage: 'NEW', id: meeting.id, title: meeting.title, when: meeting.meetingDate, where: meeting.location, details: meeting.agenda }, { excludeUserId: createdById })
        .catch((err) => console.error(`[whatsapp] meeting ${meeting.id} scheduled failed:`, err));
    }
    return meeting;
  }

  async findAll(societyId: string, page: number, limit: number, forResident = false) {
    const { skip, take } = getPaginationParams({ page, limit });
    const where = {
      societyId,
      ...(forResident ? { isPublished: true } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.meeting.findMany({
        skip,
        take,
        where,
        include: {
          minutes: { select: { id: true, isPublished: true, summary: true } },
          createdBy: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { attendees: true } },
        },
        orderBy: { meetingDate: 'desc' },
      }),
      this.prisma.meeting.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(societyId: string, id: string, forResident = false) {
    const meeting = await this.prisma.meeting.findFirst({
      where: {
        id,
        societyId,
        // DEFECT-7: Residents can only access published meetings by direct ID
        ...(forResident ? { isPublished: true } : {}),
      },
      include: {
        minutes: true,
        attendees: true,
        createdBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!meeting) throw new NotFoundException('Meeting not found');
    return meeting;
  }

  async addMinutes(societyId: string, meetingId: string, content: string, summary?: string) {
    await this.findOne(societyId, meetingId);
    return this.prisma.meetingMinutes.upsert({
      where: { meetingId },
      create: { meetingId, content, summary },
      update: { content, summary },
    });
  }

  async publishMinutes(societyId: string, meetingId: string) {
    await this.findOne(societyId, meetingId);
    return this.prisma.$transaction(async (tx) => {
      await tx.meeting.update({ where: { id: meetingId }, data: { isPublished: true } });
      return tx.meetingMinutes.update({
        where: { meetingId },
        data: { isPublished: true, publishedAt: new Date() },
      });
    });
  }

  async addAttendees(societyId: string, meetingId: string, attendees: { name: string; flatCode?: string; role?: string }[]) {
    await this.findOne(societyId, meetingId);
    return this.prisma.meetingAttendee.createMany({
      data: attendees.map((a) => ({ meetingId, ...a })),
    });
  }
}
