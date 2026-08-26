import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { SystemRole } from '@prisma/client';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
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
}
