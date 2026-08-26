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

    return { data, meta: buildPaginationMeta(total, page, limit) };
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
    return flat;
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
    await this.findOne(societyId, id);
    const { buildingId, ...rest } = dto;
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
    return this.prisma.flat.findMany({
      where: { societyId, buildingId, deletedAt: null },
      orderBy: { flatCode: 'asc' },
    });
  }
}
