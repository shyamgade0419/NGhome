import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';
import { CreateMeetingDto } from './dto/create-meeting.dto';
export { CreateMeetingDto } from './dto/create-meeting.dto';

@Injectable()
export class MeetingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(societyId: string, createdById: string, dto: CreateMeetingDto) {
    return this.prisma.meeting.create({
      data: {
        societyId,
        createdById,
        title: dto.title,
        meetingDate: new Date(dto.meetingDate),
        location: dto.location,
        agenda: dto.agenda,
      },
    });
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
