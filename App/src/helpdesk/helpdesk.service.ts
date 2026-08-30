import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MaintenanceRequestStatus } from '@prisma/client';
import { CreateMaintenanceRequestDto, UpdateRequestStatusDto } from './dto/create-request.dto';

@Injectable()
export class HelpdeskService {
  constructor(private readonly prisma: PrismaService) {}

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

  async findOne(societyId: string, id: string) {
    const req = await this.prisma.maintenanceRequest.findFirst({
      where: { id, societyId },
      include: {
        resident: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        flat: { select: { id: true, unitNumber: true, flatCode: true } },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!req) throw new NotFoundException('Maintenance request not found');
    return req;
  }

  async updateStatus(societyId: string, id: string, dto: UpdateRequestStatusDto) {
    await this.findOne(societyId, id);
    const resolvedAt =
      dto.status === 'RESOLVED' || dto.status === 'CLOSED' ? new Date() : undefined;

    return this.prisma.maintenanceRequest.update({
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
  }
}
