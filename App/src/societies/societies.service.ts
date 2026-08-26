import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSocietyDto } from './dto/create-society.dto';
import { UpdateSocietyConfigDto } from './dto/update-society-config.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';
import { Prisma } from '@prisma/client';

@Injectable()
export class SocietiesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateSocietyDto, creatorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const society = await tx.society.create({
        data: {
          name: dto.name,
          displayName: dto.displayName,
          address: dto.address,
          city: dto.city,
          state: dto.state,
          pincode: dto.pincode,
          email: dto.email,
          phone: dto.phone,
          configuration: {
            create: {}, // Default configuration
          },
        },
      });

      // Add creator as Society Admin
      await tx.societyMembership.create({
        data: {
          societyId: society.id,
          userId: creatorId,
          role: 'SOCIETY_ADMIN',
          isPrimary: false,
          status: 'ACTIVE',
        },
      });

      return society;
    });
  }

  async findAll(page: number, limit: number) {
    const { skip, take } = getPaginationParams({ page, limit });
    const [data, total] = await Promise.all([
      this.prisma.society.findMany({
        skip,
        take,
        where: { deletedAt: null },
        include: { _count: { select: { memberships: true, buildings: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.society.count({ where: { deletedAt: null } }),
    ]);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  async findOne(id: string) {
    const society = await this.prisma.society.findUnique({
      where: { id, deletedAt: null },
      include: {
        configuration: true,
        _count: {
          select: { memberships: true, buildings: true },
        },
      },
    });
    if (!society) throw new NotFoundException('Society not found');
    return society;
  }

  async findOneForMember(id: string, userId: string) {
    const membership = await this.prisma.societyMembership.findFirst({
      where: { societyId: id, userId, status: 'ACTIVE' },
    });
    if (!membership) throw new ForbiddenException('Not a member of this society');
    return this.findOne(id);
  }

  async update(id: string, dto: Partial<CreateSocietyDto>) {
    await this.findOne(id);
    return this.prisma.society.update({
      where: { id },
      data: dto,
    });
  }

  async updateConfiguration(societyId: string, dto: UpdateSocietyConfigDto) {
    await this.findOne(societyId);
    return this.prisma.societyConfiguration.upsert({
      where: { societyId },
      create: {
        ...dto,
        societyId,
      } as Prisma.SocietyConfigurationUncheckedCreateInput,
      update: dto as Prisma.SocietyConfigurationUpdateInput,
    });
  }

  async getConfiguration(societyId: string) {
    const config = await this.prisma.societyConfiguration.findUnique({
      where: { societyId },
    });
    if (!config) throw new NotFoundException('Society configuration not found');
    return config;
  }

  async getStats(societyId: string) {
    const [buildings, flats, members, activePeriod] = await Promise.all([
      this.prisma.building.count({ where: { societyId, isActive: true } }),
      this.prisma.flat.count({ where: { societyId, isActive: true } }),
      this.prisma.societyMembership.count({ where: { societyId, status: 'ACTIVE' } }),
      this.prisma.billingPeriod.findFirst({
        where: { societyId, status: { not: 'CLOSED' } },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return { buildings, flats, members, currentPeriod: activePeriod };
  }
}
