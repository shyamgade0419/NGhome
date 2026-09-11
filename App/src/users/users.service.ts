import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SystemRole, AuditAction } from '@prisma/client';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';

const USER_SELECT = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  isActive: true,
  isPlatformAdmin: true,
  emailVerified: true,
  phoneVerified: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (exists) throw new ConflictException('Email already registered');

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        isPlatformAdmin: dto.isPlatformAdmin ?? false,
      },
      select: USER_SELECT,
    });

    return user;
  }

  async findAll(page: number, limit: number) {
    const { skip, take } = getPaginationParams({ page, limit });
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({ skip, take, where: { deletedAt: null }, select: USER_SELECT, orderBy: { createdAt: 'desc' } }),
      this.prisma.user.count({ where: { deletedAt: null } }),
    ]);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string, societyId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id,
        deletedAt: null,
        memberships: { some: { societyId, status: 'ACTIVE' } },
      },
      select: {
        ...USER_SELECT,
        memberships: {
          where: { societyId, status: 'ACTIVE' },
          include: {
            society: { select: { id: true, name: true } },
            flat: { select: { id: true, flatCode: true } },
          },
        },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async update(id: string, societyId: string, dto: UpdateUserDto) {
    await this.findOne(id, societyId);
    return this.prisma.user.update({
      where: { id },
      data: dto,
      select: USER_SELECT,
    });
  }

  async deactivate(id: string, societyId: string) {
    // Verify user belongs to this society before deactivating
    await this.findOne(id, societyId);
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
      select: USER_SELECT,
    });
  }

  // Get users belonging to a specific society
  async findBySociety(societyId: string, page: number, limit: number) {
    const { skip, take } = getPaginationParams({ page, limit });
    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        skip,
        take,
        where: {
          deletedAt: null,
          memberships: { some: { societyId, status: 'ACTIVE' } },
        },
        select: {
          ...USER_SELECT,
          memberships: {
            where: { societyId, status: 'ACTIVE' },
            include: { flat: { select: { id: true, flatCode: true } } },
          },
        },
        orderBy: { firstName: 'asc' },
      }),
      this.prisma.user.count({
        where: {
          deletedAt: null,
          memberships: { some: { societyId, status: 'ACTIVE' } },
        },
      }),
    ]);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async addToSociety(
    societyId: string,
    userId: string,
    flatId: string | undefined,
    role: SystemRole,
    isPrimary: boolean,
  ) {
    // Verify society and user exist
    const [society, user] = await Promise.all([
      this.prisma.society.findUnique({ where: { id: societyId } }),
      this.prisma.user.findUnique({ where: { id: userId } }),
    ]);
    if (!society) throw new NotFoundException('Society not found');
    if (!user) throw new NotFoundException('User not found');

    // DEFECT-1: Verify flat belongs to this society (never trust client-supplied flatId)
    if (flatId) {
      const flat = await this.prisma.flat.findFirst({ where: { id: flatId, societyId } });
      if (!flat) throw new NotFoundException('Flat not found in this society');
    }

    // No flatId means "change this person's role" (e.g. promoting a
    // resident to admin from the Roles UI), not "add them to this flat" —
    // update whichever membership they already have rather than upserting
    // on flatId: '', which silently created a second, flat-less membership
    // and left their real one (with their actual flat) untouched. A user
    // is only "admin AND resident" correctly when it's the SAME membership
    // row carrying both the role and the flatId — two separate rows for
    // one person in one society made the login/society-selection flow
    // list that society twice with no way to tell the rows apart.
    if (!flatId) {
      const existing = await this.prisma.societyMembership.findMany({
        where: { societyId, userId, status: 'ACTIVE' },
      });
      if (existing.length === 1) {
        return this.prisma.societyMembership.update({
          where: { id: existing[0].id },
          data: { role, isPrimary },
        });
      }
      if (existing.length > 1) {
        throw new ConflictException(
          'This member holds more than one flat membership in this society — specify which flat to update.',
        );
      }
      // No existing membership at all — falls through to create one below, flat-less.
    }

    return this.prisma.societyMembership.upsert({
      where: { societyId_userId_flatId: { societyId, userId, flatId: flatId ?? '' } },
      create: { societyId, userId, flatId, role, isPrimary, status: 'ACTIVE' },
      update: { role, isPrimary, status: 'ACTIVE', leftAt: null },
    });
  }

  async removeFromSociety(societyId: string, userId: string) {
    await this.prisma.societyMembership.updateMany({
      where: { societyId, userId },
      data: { status: 'INACTIVE', leftAt: new Date() },
    });
  }

  // ─── Pending join approvals ──────────────────────────────────────────────
  // A resident who registers via join code onto a flat that already has an
  // active resident lands here as PENDING instead of getting instant access
  // (see AuthService.joinSociety). Nothing else creates PENDING memberships.

  async listPendingMemberships(societyId: string) {
    return this.prisma.societyMembership.findMany({
      where: { societyId, status: 'PENDING' },
      include: {
        user: { select: USER_SELECT },
        flat: { select: { id: true, flatCode: true, unitNumber: true, building: { select: { name: true } } } },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async approveMembership(societyId: string, membershipId: string, actorId: string) {
    const membership = await this.prisma.societyMembership.findFirst({
      where: { id: membershipId, societyId, status: 'PENDING' },
    });
    if (!membership) throw new NotFoundException('Pending membership not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.societyMembership.update({
        where: { id: membershipId },
        data: { status: 'ACTIVE' },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          societyId,
          action: AuditAction.USER_MODIFIED,
          entityType: 'SocietyMembership',
          entityId: membershipId,
          newValues: { status: 'ACTIVE', method: 'admin_approval' } as Record<string, string>,
        },
      });
      return result;
    });

    return updated;
  }

  async rejectMembership(societyId: string, membershipId: string, actorId: string) {
    const membership = await this.prisma.societyMembership.findFirst({
      where: { id: membershipId, societyId, status: 'PENDING' },
    });
    if (!membership) throw new NotFoundException('Pending membership not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.societyMembership.update({
        where: { id: membershipId },
        data: { status: 'INACTIVE', leftAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          societyId,
          action: AuditAction.USER_MODIFIED,
          entityType: 'SocietyMembership',
          entityId: membershipId,
          newValues: { status: 'INACTIVE', method: 'admin_rejection' } as Record<string, string>,
        },
      });
    });
  }
}
