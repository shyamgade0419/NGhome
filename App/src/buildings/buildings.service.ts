import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateBuildingDto } from './dto/create-building.dto';

@Injectable()
export class BuildingsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(societyId: string, dto: CreateBuildingDto) {
    return this.prisma.building.create({
      data: { societyId, ...dto },
    });
  }

  async findAll(societyId: string) {
    return this.prisma.building.findMany({
      where: { societyId, deletedAt: null },
      include: {
        _count: { select: { flats: true, floors: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(societyId: string, id: string) {
    const building = await this.prisma.building.findFirst({
      where: { id, societyId, deletedAt: null },
      include: {
        floors: { orderBy: { number: 'asc' } },
        _count: { select: { flats: true } },
      },
    });
    if (!building) throw new NotFoundException('Building not found');
    return building;
  }

  async update(societyId: string, id: string, dto: Partial<CreateBuildingDto>) {
    await this.findOne(societyId, id);
    return this.prisma.building.update({
      where: { id },
      data: dto,
    });
  }

  async softDelete(societyId: string, id: string) {
    await this.findOne(societyId, id);
    return this.prisma.building.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  }

  async addFloor(societyId: string, buildingId: string, number: number, name?: string) {
    await this.findOne(societyId, buildingId);
    return this.prisma.floor.create({
      data: { buildingId, number, name },
    });
  }
}
