import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSocietyDto } from './dto/create-society.dto';
import { UpdateSocietyConfigDto } from './dto/update-society-config.dto';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';
import { generateUniqueJoinCode } from '../common/utils/join-code.util';
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

    // upiId has no DB column; store it in the existing additionalConfig JSON field
    const { upiId, ...configFields } = dto as UpdateSocietyConfigDto & { upiId?: string };

    let additionalConfigPatch: Prisma.InputJsonValue | undefined;
    if (upiId !== undefined) {
      const current = await this.prisma.societyConfiguration.findUnique({
        where: { societyId },
        select: { additionalConfig: true },
      });
      const existing = (current?.additionalConfig as Record<string, unknown>) ?? {};
      additionalConfigPatch = { ...existing, upiId } as Prisma.InputJsonValue;
    }

    const data: Prisma.SocietyConfigurationUpdateInput = {
      ...configFields,
      ...(additionalConfigPatch !== undefined ? { additionalConfig: additionalConfigPatch } : {}),
    };

    return this.prisma.societyConfiguration.upsert({
      where: { societyId },
      create: {
        ...configFields,
        ...(additionalConfigPatch !== undefined ? { additionalConfig: additionalConfigPatch } : {}),
        societyId,
      } as Prisma.SocietyConfigurationUncheckedCreateInput,
      update: data,
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

  // ─── Join-code endpoints ────────────────────────────────────────────────────

  /**
   * Public lookup — resolves a join code to the society's name + flat list.
   * Returns only what a prospective resident needs to fill the join form.
   * No authentication required; the join code itself is the gate.
   */
  async findByJoinCode(joinCode: string) {
    const code = joinCode.toUpperCase().trim();
    const society = await this.prisma.society.findUnique({
      where: { joinCode: code },
      include: {
        buildings: {
          where: { isActive: true, deletedAt: null },
          include: {
            flats: {
              where: { isActive: true, deletedAt: null },
              select: { id: true, flatCode: true, unitNumber: true },
              orderBy: { flatCode: 'asc' },
            },
          },
          orderBy: { name: 'asc' },
        },
      },
    });

    if (!society || !society.isActive || society.deletedAt) {
      throw new NotFoundException('Society not found for this join code');
    }

    const flats = society.buildings.flatMap((b) =>
      b.flats.map((f) => ({ id: f.id, flatCode: f.flatCode })),
    );

    return {
      id: society.id,
      name: society.name,
      displayName: society.displayName,
      flats,
    };
  }

  /**
   * Admin-only — return the current join code for the admin's society.
   * Generates one on the fly if the society was created before this feature.
   */
  async getJoinCode(societyId: string): Promise<{ joinCode: string; generatedAt: Date | null }> {
    let society = await this.prisma.society.findUnique({
      where: { id: societyId },
      select: { id: true, joinCode: true, joinCodeGeneratedAt: true, isActive: true },
    });
    if (!society) throw new NotFoundException('Society not found');

    // Back-fill for societies created before this feature
    if (!society.joinCode) {
      const newCode = await generateUniqueJoinCode(this.prisma);
      society = await this.prisma.society.update({
        where: { id: societyId },
        data: { joinCode: newCode, joinCodeGeneratedAt: new Date() },
        select: { id: true, joinCode: true, joinCodeGeneratedAt: true, isActive: true },
      });
    }

    return {
      joinCode: society.joinCode!,
      generatedAt: society.joinCodeGeneratedAt,
    };
  }

  /**
   * Admin-only — rotate the join code. Invalidates the old code immediately.
   * Existing members are unaffected; only new join attempts use the new code.
   */
  async regenerateJoinCode(societyId: string): Promise<{ joinCode: string; generatedAt: Date }> {
    const society = await this.prisma.society.findUnique({ where: { id: societyId } });
    if (!society) throw new NotFoundException('Society not found');

    const newCode = await generateUniqueJoinCode(this.prisma);
    const now = new Date();

    await this.prisma.society.update({
      where: { id: societyId },
      data: { joinCode: newCode, joinCodeGeneratedAt: now },
    });

    return { joinCode: newCode, generatedAt: now };
  }
}
