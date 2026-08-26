import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditAction, Prisma } from '@prisma/client';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';

@Injectable()
export class AuditLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async log(data: {
    actorId: string;
    societyId?: string;
    action: AuditAction;
    entityType?: string;
    entityId?: string;
    oldValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
    metadata?: Record<string, unknown>;
  }) {
    return this.prisma.auditLog.create({
      data: {
        actorId: data.actorId,
        societyId: data.societyId,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        oldValues: data.oldValues as Prisma.InputJsonValue,
        newValues: data.newValues as Prisma.InputJsonValue,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async findAll(societyId: string, page: number, limit: number, filters?: {
    action?: AuditAction;
    actorId?: string;
    entityType?: string;
    fromDate?: string;
    toDate?: string;
  }) {
    const { skip, take } = getPaginationParams({ page, limit });
    const where: Prisma.AuditLogWhereInput = {
      societyId,
      ...(filters?.action ? { action: filters.action } : {}),
      ...(filters?.actorId ? { actorId: filters.actorId } : {}),
      ...(filters?.entityType ? { entityType: filters.entityType } : {}),
      ...(filters?.fromDate || filters?.toDate
        ? {
            createdAt: {
              ...(filters?.fromDate ? { gte: new Date(filters.fromDate) } : {}),
              ...(filters?.toDate ? { lte: new Date(filters.toDate) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        skip,
        take,
        where,
        include: {
          actor: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, meta: buildPaginationMeta(total, page, limit) };
  }
}
