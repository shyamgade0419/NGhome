import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma, SystemRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { buildPaginationMeta, getPaginationParams } from '../common/utils/pagination';
import { AddVehicleDto, AllocateSlotDto, AssignVehicleDto, BulkSlotsDto, CreateSlotDto } from './dto/vehicle.dto';
import { VEHICLE_LIMITS, bulkCodes, fitsSlot, normalizePlate, normalizeSearch } from './vehicle-rules';

type SlotRow = Prisma.ParkingSlotGetPayload<{ include: { flat: { select: { flatCode: true } }; vehicle: { select: { plate: true; kind: true } } } }>;

const SLOT_INCLUDE = { flat: { select: { flatCode: true } }, vehicle: { select: { plate: true, kind: true } } } satisfies Prisma.ParkingSlotInclude;

@Injectable()
export class VehiclesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Resident: my vehicles and my parking ──────────────────────────────────

  async addVehicle(societyId: string, user: AuthenticatedUser, dto: AddVehicleDto) {
    const flatId = this.requireFlat(user);
    const plate = normalizePlate(dto.plate);
    if (!plate) throw new BadRequestException('That is not a valid number plate (4–12 letters and digits).');

    const flat = await this.prisma.flat.findFirst({ where: { id: flatId, societyId, isActive: true, deletedAt: null }, select: { id: true } });
    if (!flat) throw new ForbiddenException('Your flat could not be found in this society.');

    const count = await this.prisma.vehicle.count({ where: { societyId, flatId, active: true } });
    if (count >= VEHICLE_LIMITS.perFlat) {
      throw new BadRequestException(`A flat can have at most ${VEHICLE_LIMITS.perFlat} vehicles registered. Remove one first.`);
    }

    try {
      const vehicle = await this.prisma.vehicle.create({
        data: { societyId, flatId, plate, kind: dto.kind, make: dto.make || null, colour: dto.colour || null, createdById: user.id },
      });
      await this.audit(societyId, user.id, 'Vehicle', vehicle.id, null, { action: 'VEHICLE_ADDED', kind: vehicle.kind });
      return vehicle;
    } catch (err) {
      // One live plate per society (partial unique index). Say nothing about whose it is.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This number is already registered in the society. If the vehicle has moved to you, ask the committee to remove the old record.');
      }
      throw err;
    }
  }

  async myVehicles(societyId: string, user: AuthenticatedUser) {
    const flatId = this.requireFlat(user);
    const rows = await this.prisma.vehicle.findMany({
      where: { societyId, flatId, active: true },
      include: { slots: { select: { id: true, code: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((v) => ({ ...v, slots: v.slots }));
  }

  /** Takes a vehicle off the household's list, frees the slot it was in, and frees the plate. History is kept. */
  async removeVehicle(societyId: string, user: AuthenticatedUser, vehicleId: string, reason?: string) {
    const flatId = this.requireFlat(user);
    const claimed = await this.deactivate({ id: vehicleId, societyId, flatId }, user.id, reason ?? null);
    if (!claimed) throw new NotFoundException('Vehicle not found');
    await this.audit(societyId, user.id, 'Vehicle', vehicleId, { active: true }, { action: 'VEHICLE_REMOVED', byHousehold: true });
    return { removed: true };
  }

  async myParking(societyId: string, user: AuthenticatedUser) {
    const flatId = this.requireFlat(user);
    const rows = await this.prisma.parkingSlot.findMany({ where: { societyId, flatId }, include: SLOT_INCLUDE, orderBy: { code: 'asc' } });
    return rows.map((r) => this.publicSlot(r));
  }

  /**
   * The household says which of its vehicles uses one of its slots. Both must be the household's
   * own, the vehicle must still be registered and fit the slot, and one vehicle sits in one slot:
   * putting it here takes it out of any other. A null vehicle clears the slot.
   */
  async assignVehicle(societyId: string, user: AuthenticatedUser, slotId: string, dto: AssignVehicleDto) {
    const flatId = this.requireFlat(user);
    const slot = await this.prisma.parkingSlot.findFirst({ where: { id: slotId, societyId, flatId } });
    if (!slot) throw new NotFoundException('Parking slot not found');

    if (!dto.vehicleId) {
      await this.prisma.parkingSlot.update({ where: { id: slotId }, data: { vehicleId: null } });
    } else {
      const vehicle = await this.prisma.vehicle.findFirst({ where: { id: dto.vehicleId, societyId, flatId, active: true } });
      if (!vehicle) throw new NotFoundException('Vehicle not found');
      if (!fitsSlot(vehicle.kind, slot.slotFor)) {
        throw new BadRequestException(slot.slotFor === 'CAR' ? 'That is a car slot. Only a car can use it.' : 'That is a two-wheeler slot. Only a two-wheeler or cycle can use it.');
      }
      await this.prisma.$transaction([
        this.prisma.parkingSlot.updateMany({ where: { societyId, vehicleId: vehicle.id, id: { not: slotId } }, data: { vehicleId: null } }),
        this.prisma.parkingSlot.update({ where: { id: slotId }, data: { vehicleId: vehicle.id } }),
      ]);
    }
    const updated = await this.prisma.parkingSlot.findUniqueOrThrow({ where: { id: slotId }, include: SLOT_INCLUDE });
    return this.publicSlot(updated);
  }

  // ── Gate ──────────────────────────────────────────────────────────────────

  /**
   * Whose is this vehicle? The guard types as much of a plate as they can see (usually the last
   * digits); at least three characters, so the lookup cannot be used to list every vehicle. The
   * answer is a flat number and the slot, never a resident's name or phone.
   */
  async lookup(societyId: string, search: string | undefined) {
    const q = normalizeSearch(search);
    if (q.length < VEHICLE_LIMITS.minSearch) {
      throw new BadRequestException(`Type at least ${VEHICLE_LIMITS.minSearch} letters or digits of the number.`);
    }
    const rows = await this.prisma.vehicle.findMany({
      where: { societyId, active: true, plate: { contains: q } },
      include: { flat: { select: { flatCode: true } }, slots: { select: { code: true } } },
      orderBy: { plate: 'asc' },
      take: 10,
    });
    return rows.map((v) => ({ id: v.id, plate: v.plate, kind: v.kind, make: v.make, colour: v.colour, flatCode: v.flat.flatCode, slotCodes: v.slots.map((s) => s.code).sort() }));
  }

  // ── Committee: the register ───────────────────────────────────────────────

  async adminVehicles(societyId: string, q: { page?: number; limit?: number; search?: string; flatId?: string; removed?: boolean }) {
    const { skip, take, page, limit } = getPaginationParams({ page: q.page ?? 1, limit: q.limit ?? 25 });
    const term = q.search?.trim();
    const plateTerm = normalizeSearch(term);
    const where: Prisma.VehicleWhereInput = {
      societyId,
      active: q.removed ? false : true,
      ...(q.flatId ? { flatId: q.flatId } : {}),
      ...(term
        ? {
            OR: [
              ...(plateTerm ? [{ plate: { contains: plateTerm } }] : []),
              { flat: { flatCode: { contains: term, mode: 'insensitive' as const } } },
              { make: { contains: term, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        include: { flat: { select: { flatCode: true } }, slots: { select: { code: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.vehicle.count({ where }),
    ]);
    return {
      data: rows.map((v) => ({ ...v, flatCode: v.flat.flatCode, slotCodes: v.slots.map((s) => s.code).sort(), flat: undefined, slots: undefined })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  /** The committee removes a record, typically a plate that moved to a new owner. The household is told why. */
  async committeeRemoveVehicle(societyId: string, admin: AuthenticatedUser, vehicleId: string, reason: string) {
    const existing = await this.prisma.vehicle.findFirst({ where: { id: vehicleId, societyId, active: true }, select: { flatId: true, plate: true } });
    if (!existing) throw new NotFoundException('Vehicle not found');
    const claimed = await this.deactivate({ id: vehicleId, societyId }, admin.id, reason);
    if (!claimed) throw new ConflictException('This vehicle was already removed.');
    await this.audit(societyId, admin.id, 'Vehicle', vehicleId, { active: true }, { action: 'VEHICLE_REMOVED', byCommittee: true, reason });
    await this.notifyFlats(societyId, [existing.flatId], {
      title: 'A vehicle was removed from your list',
      body: `${existing.plate} was removed by the committee: ${reason}`,
      type: 'VEHICLE_REMOVED',
    }, `vehicle ${vehicleId} removed`);
    return { removed: true };
  }

  // ── Committee: parking slots ──────────────────────────────────────────────

  async adminSlots(societyId: string, q: { page?: number; limit?: number; search?: string; status?: 'FREE' | 'ALLOCATED' | 'VISITOR'; flatId?: string }) {
    const { skip, take, page, limit } = getPaginationParams({ page: q.page ?? 1, limit: q.limit ?? 50 });
    const term = q.search?.trim();
    const where: Prisma.ParkingSlotWhereInput = {
      societyId,
      ...(q.status === 'FREE' ? { flatId: null, visitor: false } : q.status === 'ALLOCATED' ? { flatId: { not: null } } : q.status === 'VISITOR' ? { visitor: true } : {}),
      ...(q.flatId ? { flatId: q.flatId } : {}),
      ...(term ? { OR: [{ code: { contains: term, mode: 'insensitive' as const } }, { flat: { flatCode: { contains: term, mode: 'insensitive' as const } } }] } : {}),
    };
    const [rows, total, free, allocated] = await Promise.all([
      this.prisma.parkingSlot.findMany({ where, include: SLOT_INCLUDE, orderBy: { code: 'asc' }, skip, take }),
      this.prisma.parkingSlot.count({ where }),
      this.prisma.parkingSlot.count({ where: { societyId, flatId: null, visitor: false } }),
      this.prisma.parkingSlot.count({ where: { societyId, flatId: { not: null } } }),
    ]);
    // Counts ride in meta: the response wrapper keeps only { data, meta }.
    return { data: rows.map((r) => this.publicSlot(r)), meta: { ...buildPaginationMeta(total, page, limit), free, allocated } };
  }

  async createSlot(societyId: string, admin: AuthenticatedUser, dto: CreateSlotDto) {
    try {
      const slot = await this.prisma.parkingSlot.create({
        data: { societyId, code: dto.code, area: dto.area || null, slotFor: dto.slotFor ?? 'ANY', visitor: dto.visitor ?? false },
        include: SLOT_INCLUDE,
      });
      await this.audit(societyId, admin.id, 'ParkingSlot', slot.id, null, { action: 'SLOT_CREATED', code: slot.code });
      return this.publicSlot(slot);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`There is already a slot called ${dto.code}.`);
      }
      throw err;
    }
  }

  /** Many slots in one go. All or none: a code that already exists stops the whole request, so a typo cannot half-create a block. */
  async bulkCreateSlots(societyId: string, admin: AuthenticatedUser, dto: BulkSlotsDto) {
    const codes = bulkCodes(dto.prefix ?? '', dto.from, dto.to, dto.pad ?? 0);
    if (!codes) throw new BadRequestException(`Give a range with from at most to, and no more than ${VEHICLE_LIMITS.bulkSlots} slots.`);
    if (codes.some((c) => c.length > 20)) throw new BadRequestException('A slot code can be at most 20 characters.');

    const clash = await this.prisma.parkingSlot.findMany({ where: { societyId, code: { in: codes } }, select: { code: true }, take: 5 });
    if (clash.length) throw new ConflictException(`These slots already exist: ${clash.map((c) => c.code).join(', ')}. Nothing was created.`);

    try {
      await this.prisma.parkingSlot.createMany({
        data: codes.map((code) => ({ societyId, code, area: dto.area || null, slotFor: dto.slotFor ?? 'ANY', visitor: dto.visitor ?? false })),
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Some of those slots already exist. Nothing was created.');
      }
      throw err;
    }
    await this.audit(societyId, admin.id, 'ParkingSlot', societyId, null, { action: 'SLOTS_CREATED', count: codes.length, first: codes[0], last: codes[codes.length - 1] });
    return { created: codes.length, first: codes[0], last: codes[codes.length - 1] };
  }

  /** Only a slot nobody holds can be deleted; release it first otherwise. */
  async deleteSlot(societyId: string, admin: AuthenticatedUser, slotId: string) {
    const claimed = await this.prisma.parkingSlot.deleteMany({ where: { id: slotId, societyId, flatId: null } });
    if (claimed.count === 0) {
      const exists = await this.prisma.parkingSlot.findFirst({ where: { id: slotId, societyId }, select: { id: true } });
      if (!exists) throw new NotFoundException('Parking slot not found');
      throw new ConflictException('This slot is allocated to a flat. Release it first.');
    }
    await this.audit(societyId, admin.id, 'ParkingSlot', slotId, { exists: true }, { action: 'SLOT_DELETED' });
    return { deleted: true };
  }

  /**
   * Gives a free slot to a flat: one atomic update that only succeeds while the slot is free and not
   * a visitor slot, so two committee members allocating the same slot cannot both win.
   */
  async allocate(societyId: string, admin: AuthenticatedUser, slotId: string, dto: AllocateSlotDto) {
    const flat = await this.prisma.flat.findFirst({ where: { id: dto.flatId, societyId, isActive: true, deletedAt: null }, select: { id: true, flatCode: true } });
    if (!flat) throw new NotFoundException('That flat does not exist in this society.');

    const claimed = await this.prisma.parkingSlot.updateMany({
      where: { id: slotId, societyId, visitor: false, flatId: null },
      data: { flatId: flat.id, vehicleId: null, allocatedAt: new Date(), allocatedById: admin.id },
    });
    if (claimed.count === 0) {
      const slot = await this.prisma.parkingSlot.findFirst({ where: { id: slotId, societyId } });
      if (!slot) throw new NotFoundException('Parking slot not found');
      if (slot.visitor) throw new ConflictException('A visitor slot cannot be given to a flat.');
      throw new ConflictException('This slot is already allocated. Release it first.');
    }
    const slot = await this.prisma.parkingSlot.findUniqueOrThrow({ where: { id: slotId }, include: SLOT_INCLUDE });
    await this.audit(societyId, admin.id, 'ParkingSlot', slotId, { flatId: null }, { action: 'SLOT_ALLOCATED', code: slot.code, flatCode: flat.flatCode });
    await this.notifyFlats(societyId, [flat.id], { title: 'A parking slot was allocated to your flat', body: `Slot ${slot.code}${slot.area ? ` (${slot.area})` : ''} is now yours.`, type: 'PARKING_ALLOCATED' }, `slot ${slotId} allocated`);
    return this.publicSlot(slot);
  }

  async release(societyId: string, admin: AuthenticatedUser, slotId: string) {
    const before = await this.prisma.parkingSlot.findFirst({ where: { id: slotId, societyId }, include: SLOT_INCLUDE });
    if (!before) throw new NotFoundException('Parking slot not found');
    const claimed = await this.prisma.parkingSlot.updateMany({
      where: { id: slotId, societyId, flatId: { not: null } },
      data: { flatId: null, vehicleId: null, allocatedAt: null, allocatedById: null },
    });
    if (claimed.count === 0) throw new ConflictException('This slot is not allocated.');
    await this.audit(societyId, admin.id, 'ParkingSlot', slotId, { flatCode: before.flat?.flatCode ?? null }, { action: 'SLOT_RELEASED', code: before.code });
    if (before.flatId) {
      await this.notifyFlats(societyId, [before.flatId], { title: 'A parking slot was taken back', body: `Slot ${before.code} is no longer allocated to your flat.`, type: 'PARKING_RELEASED' }, `slot ${slotId} released`);
    }
    const slot = await this.prisma.parkingSlot.findUniqueOrThrow({ where: { id: slotId }, include: SLOT_INCLUDE });
    return this.publicSlot(slot);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** Household actions belong to the people who live there; gate staff are refused even if their account carries a flat. */
  private requireFlat(user: AuthenticatedUser): string {
    if (user.currentRole === SystemRole.SECURITY_GUARD) {
      throw new ForbiddenException('Gate staff cannot use household vehicle actions. Use the gate screen.');
    }
    if (!user.flatId) throw new ForbiddenException('Only members who belong to a flat can manage vehicles.');
    return user.flatId;
  }

  /** One atomic step: the vehicle goes inactive (freeing its plate) and leaves any slot, together or not at all. */
  private async deactivate(where: { id: string; societyId: string; flatId?: string }, actorId: string, reason: string | null): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.vehicle.updateMany({
        where: { ...where, active: true },
        data: { active: false, removedAt: new Date(), removedById: actorId, removedReason: reason },
      });
      if (claimed.count === 0) return false;
      await tx.parkingSlot.updateMany({ where: { societyId: where.societyId, vehicleId: where.id }, data: { vehicleId: null } });
      return true;
    });
  }

  private async notifyFlats(societyId: string, flatIds: string[], payload: { title: string; body: string; type: string }, context: string) {
    await this.notifications.notifyQuietly(async () => {
      const rows = await this.prisma.societyMembership.findMany({
        where: { societyId, flatId: { in: flatIds }, status: 'ACTIVE', role: { not: SystemRole.SECURITY_GUARD } },
        select: { userId: true },
      });
      const ids = [...new Set(rows.map((r) => r.userId))];
      if (ids.length) await this.notifications.sendToUsers(societyId, ids, { ...payload, data: {} });
    }, context);
  }

  private publicSlot(s: SlotRow) {
    const { flat, vehicle, ...rest } = s;
    return { ...rest, flatCode: flat?.flatCode ?? null, vehiclePlate: vehicle?.plate ?? null, vehicleKind: vehicle?.kind ?? null };
  }

  private async audit(
    societyId: string,
    actorId: string,
    entityType: string,
    entityId: string,
    oldValues: Record<string, unknown> | null,
    newValues: Record<string, unknown>,
  ) {
    await this.prisma.auditLog.create({
      data: {
        societyId,
        actorId,
        action: AuditAction.OTHER,
        entityType,
        entityId,
        ...(oldValues ? { oldValues: oldValues as Prisma.InputJsonValue } : {}),
        newValues: newValues as Prisma.InputJsonValue,
      },
    });
  }
}
