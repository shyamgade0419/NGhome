import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFlatDto } from './dto/create-flat.dto';
import { getPaginationParams, buildPaginationMeta } from '../common/utils/pagination';
import { Prisma } from '@prisma/client';

@Injectable()
export class FlatsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(societyId: string, dto: CreateFlatDto) {
    // Verify building belongs to society
    const building = await this.prisma.building.findFirst({
      where: { id: dto.buildingId, societyId },
    });
    if (!building) throw new NotFoundException('Building not found in this society');

    // A Floor's own scoping is by buildingId, not societyId directly — so
    // "belongs to this society" isn't enough on its own; it must belong to
    // the specific building this flat is being created under, or a flat
    // could end up carrying another building's (and via that, potentially
    // another society's) floor name/number in every findOne/findAll response.
    if (dto.floorId) {
      const floor = await this.prisma.floor.findFirst({
        where: { id: dto.floorId, buildingId: dto.buildingId },
      });
      if (!floor) throw new NotFoundException('Floor not found in this building');
    }

    return this.prisma.flat.create({
      data: {
        societyId,
        buildingId: dto.buildingId,
        floorId: dto.floorId,
        unitNumber: dto.unitNumber,
        flatCode: dto.flatCode,
        area: dto.area ? new Prisma.Decimal(dto.area) : undefined,
        bedrooms: dto.bedrooms,
        bathrooms: dto.bathrooms,
        category: dto.category,
        status: dto.status ?? 'ACTIVE',
        ownershipType: dto.ownershipType,
        parkingSlots: dto.parkingSlots ?? 0,
      },
      include: { building: { select: { id: true, name: true } } },
    });
  }

  /**
   * Bulk import (CSV/Excel on the client). Each row is created through the
   * same create() path — same building-ownership check, same defaults — so
   * there's exactly one place that knows how to make a Flat. Deliberately
   * not one DB transaction: a single bad row (typo'd building, a duplicate
   * flat code) failing the whole batch is worse for a 60-row import than
   * reporting which specific rows failed and why, while the good rows go
   * through.
   */
  async bulkCreate(societyId: string, rows: CreateFlatDto[]) {
    const created: Array<{ row: number; flatCode: string }> = [];
    const failed: Array<{ row: number; flatCode?: string; error: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const dto = rows[i];
      try {
        const flat = await this.create(societyId, dto);
        created.push({ row: i + 1, flatCode: flat.flatCode });
      } catch (err: unknown) {
        let message = 'Failed to create flat';
        if (err && typeof err === 'object') {
          // Prisma unique-constraint violation (societyId, flatCode)
          if ((err as { code?: string }).code === 'P2002') {
            message = `Flat code "${dto.flatCode}" already exists`;
          } else if ('message' in err && typeof (err as { message: unknown }).message === 'string') {
            message = (err as { message: string }).message;
          }
        }
        failed.push({ row: i + 1, flatCode: dto.flatCode, error: message });
      }
    }

    return { createdCount: created.length, failedCount: failed.length, created, failed };
  }

  async findAll(societyId: string, page: number, limit: number, buildingId?: string) {
    const { skip, take } = getPaginationParams({ page, limit });
    const where: Prisma.FlatWhereInput = {
      societyId,
      deletedAt: null,
      ...(buildingId ? { buildingId } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.flat.findMany({
        skip,
        take,
        where,
        include: {
          building: { select: { id: true, name: true, code: true } },
          memberships: {
            where: { status: 'ACTIVE' },
            include: { user: { select: { id: true, firstName: true, lastName: true } } },
          },
        },
        orderBy: { flatCode: 'asc' },
      }),
      this.prisma.flat.count({ where }),
    ]);

    return {
      // Convert Prisma Decimal 'area' to a plain number so class-transformer
      // doesn't serialise it as a raw {s,e,d} object.
      data: data.map((flat) => ({
        ...flat,
        area: flat.area != null ? Number(flat.area) : null,
      })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async findOne(societyId: string, id: string) {
    const flat = await this.prisma.flat.findFirst({
      where: { id, societyId, deletedAt: null },
      include: {
        building: { select: { id: true, name: true, code: true } },
        floor: true,
        memberships: {
          where: { status: 'ACTIVE' },
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
    });
    if (!flat) throw new NotFoundException('Flat not found');
    return { ...flat, area: flat.area != null ? Number(flat.area) : null };
  }

  // Called by resident — only their own flat
  async findMyFlat(societyId: string, userId: string, flatId: string) {
    const membership = await this.prisma.societyMembership.findFirst({
      where: { societyId, userId, flatId, status: 'ACTIVE' },
    });
    if (!membership) throw new ForbiddenException('Access denied');
    return this.findOne(societyId, flatId);
  }

  async update(societyId: string, id: string, dto: Partial<CreateFlatDto>) {
    const existing = await this.findOne(societyId, id);
    // buildingId is deliberately excluded — moving a flat to a different
    // building is not supported by this generic update.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { buildingId, ...rest } = dto;

    // Same reasoning as create(): a floorId must belong to this flat's own
    // (unchangeable via this method) building, never trusted as-is.
    if (rest.floorId) {
      const floor = await this.prisma.floor.findFirst({
        where: { id: rest.floorId, buildingId: existing.buildingId },
      });
      if (!floor) throw new NotFoundException('Floor not found in this building');
    }

    return this.prisma.flat.update({ where: { id }, data: rest });
  }

  async softDelete(societyId: string, id: string) {
    await this.findOne(societyId, id);
    return this.prisma.flat.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async findByBuilding(societyId: string, buildingId: string) {
    const flats = await this.prisma.flat.findMany({
      where: { societyId, buildingId, deletedAt: null },
      orderBy: { flatCode: 'asc' },
    });
    return flats.map((f) => ({ ...f, area: f.area != null ? Number(f.area) : null }));
  }
}
