import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AuditAction,
  DeliveryExpectation,
  DeliveryExpectationStatus,
  DeliveryInstruction,
  Parcel,
  ParcelStatus,
  Prisma,
  SystemRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { buildPaginationMeta, getPaginationParams } from '../common/utils/pagination';
import { istDayStartUtc, istDateString } from '../amenities/amenity-time';
import { CreateExpectationDto, HandOverParcelDto, ReceiveParcelDto } from './dto/delivery.dto';
import { EXPECTATION_LIMITS, expectationState } from './delivery-rules';

const HOUR = 3_600_000;
const START_GRACE_MS = 5 * 60_000;

@Injectable()
export class DeliveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Resident: "a delivery is coming" ──────────────────────────────────────

  async createExpectation(societyId: string, user: AuthenticatedUser, dto: CreateExpectationDto) {
    const flatId = this.requireFlat(user);
    const now = new Date();
    const validUntil = dto.validUntil ? new Date(dto.validUntil) : new Date(now.getTime() + EXPECTATION_LIMITS.defaultHours * HOUR);
    if (Number.isNaN(validUntil.getTime())) throw new BadRequestException('That end time is not valid.');
    if (validUntil <= now) throw new BadRequestException('That end time has already passed.');
    if (validUntil.getTime() - now.getTime() > EXPECTATION_LIMITS.maxHours * HOUR + START_GRACE_MS) {
      throw new BadRequestException(`This can last at most ${EXPECTATION_LIMITS.maxHours} hours.`);
    }

    const flat = await this.prisma.flat.findFirst({ where: { id: flatId, societyId, isActive: true, deletedAt: null }, select: { id: true } });
    if (!flat) throw new ForbiddenException('Your flat could not be found in this society.');

    const row = await this.prisma.deliveryExpectation.create({
      data: {
        societyId,
        flatId,
        createdById: user.id,
        company: dto.company,
        instruction: dto.instruction,
        note: dto.note || null,
        validFrom: now,
        validUntil,
        maxUses: dto.instruction === DeliveryInstruction.ALLOW_ENTRY ? dto.maxUses ?? 1 : 1,
      },
    });
    await this.audit(societyId, user.id, 'DeliveryExpectation', row.id, null, {
      action: 'DELIVERY_EXPECTED',
      company: row.company,
      instruction: row.instruction,
      validUntil: row.validUntil.toISOString(),
    });
    return this.publicExpectation(row, now);
  }

  async myExpectations(societyId: string, user: AuthenticatedUser) {
    const flatId = this.requireFlat(user);
    const now = new Date();
    const rows = await this.prisma.deliveryExpectation.findMany({
      where: { societyId, flatId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => this.publicExpectation(r, now));
  }

  /** Any member of the same flat may withdraw an instruction made from it. */
  async cancelExpectation(societyId: string, user: AuthenticatedUser, id: string) {
    const flatId = this.requireFlat(user);
    const now = new Date();
    const claimed = await this.prisma.deliveryExpectation.updateMany({
      where: { id, societyId, flatId, status: DeliveryExpectationStatus.ACTIVE },
      data: { status: DeliveryExpectationStatus.CANCELLED, cancelledAt: now },
    });
    if (claimed.count === 0) {
      const existing = await this.prisma.deliveryExpectation.findFirst({ where: { id, societyId, flatId } });
      if (!existing) throw new NotFoundException('Delivery instruction not found');
      throw new ConflictException('This was already cancelled.');
    }
    await this.audit(societyId, user.id, 'DeliveryExpectation', id, { status: 'ACTIVE' }, { action: 'DELIVERY_EXPECTATION_CANCELLED' });
    const row = await this.prisma.deliveryExpectation.findUniqueOrThrow({ where: { id } });
    return this.publicExpectation(row, now);
  }

  async myParcels(societyId: string, user: AuthenticatedUser, status?: ParcelStatus) {
    const flatId = this.requireFlat(user);
    const rows = await this.prisma.parcel.findMany({
      where: { societyId, flatId, ...(status ? { status } : {}) },
      orderBy: { receivedAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => this.publicParcel(r));
  }

  // ── Gate ──────────────────────────────────────────────────────────────────

  /** What residents have said about deliveries that are still live, so the guard knows before they arrive. */
  async gateExpected(societyId: string) {
    const now = new Date();
    const rows = await this.prisma.deliveryExpectation.findMany({
      where: { societyId, status: DeliveryExpectationStatus.ACTIVE, validUntil: { gte: now } },
      include: { flat: { select: { flatCode: true } } },
      orderBy: { validUntil: 'asc' },
      take: 200,
    });
    return rows
      .map((r) => ({ ...this.publicExpectation(r, now), flatCode: r.flat.flatCode }))
      .filter((r) => r.state === 'ACTIVE' || r.state === 'NOT_YET');
  }

  /**
   * Records a parcel the gate is holding and tells the flat. Retried safely: the same
   * clientRequestId returns the parcel already recorded instead of a second one.
   */
  async receiveParcel(societyId: string, guard: AuthenticatedUser, dto: ReceiveParcelDto) {
    const existing = await this.findByClientRequest(societyId, dto.clientRequestId);
    if (existing) return { parcel: this.publicParcel(existing), duplicate: true, notifiedResidents: 0 };

    const flat = await this.prisma.flat.findFirst({
      where: { id: dto.flatId, societyId, isActive: true, deletedAt: null },
      select: { id: true, flatCode: true },
    });
    if (!flat) throw new NotFoundException('That flat does not exist in this society.');

    let parcel: Parcel & { flat?: { flatCode: string } };
    try {
      parcel = await this.prisma.parcel.create({
        data: {
          societyId,
          flatId: flat.id,
          courier: dto.courier,
          recipientName: dto.recipientName || null,
          note: dto.note || null,
          receivedById: guard.id,
          clientRequestId: dto.clientRequestId,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.findByClientRequest(societyId, dto.clientRequestId);
        if (raced) return { parcel: this.publicParcel(raced), duplicate: true, notifiedResidents: 0 };
      }
      throw err;
    }
    parcel.flat = { flatCode: flat.flatCode };

    await this.audit(societyId, guard.id, 'Parcel', parcel.id, null, {
      action: 'PARCEL_RECEIVED',
      flatCode: flat.flatCode,
      courier: parcel.courier,
    });

    const residents = await this.residentIdsOfFlat(societyId, flat.id);
    await this.notifications.notifyQuietly(async () => {
      await this.notifications.sendToUsers(societyId, residents, {
        title: 'A parcel is waiting at the gate',
        body: `${parcel.courier}${parcel.recipientName ? ` for ${parcel.recipientName}` : ''} was left for ${flat.flatCode}. Collect it from the gate.`,
        type: 'PARCEL_RECEIVED',
        data: { parcelId: parcel.id },
      });
    }, `parcel ${parcel.id} received`);

    return { parcel: this.publicParcel(parcel), duplicate: false, notifiedResidents: residents.length };
  }

  /** What the guard needs today: every parcel still held, plus anything closed since midnight (India time). */
  async gateParcels(societyId: string, search?: string) {
    const todayStart = istDayStartUtc(istDateString(new Date())) ?? new Date(Date.now() - 24 * HOUR);
    const term = search?.trim();
    const rows = await this.prisma.parcel.findMany({
      where: {
        societyId,
        OR: [{ status: ParcelStatus.RECEIVED }, { closedAt: { gte: todayStart } }],
        ...(term
          ? {
              AND: [
                {
                  OR: [
                    { courier: { contains: term, mode: 'insensitive' as const } },
                    { recipientName: { contains: term, mode: 'insensitive' as const } },
                    { flat: { flatCode: { contains: term, mode: 'insensitive' as const } } },
                  ],
                },
              ],
            }
          : {}),
      },
      include: { flat: { select: { flatCode: true } } },
      orderBy: { receivedAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.publicParcel(r));
  }

  handOver(societyId: string, guard: AuthenticatedUser, id: string, dto: HandOverParcelDto) {
    return this.close(societyId, guard, id, ParcelStatus.COLLECTED, dto.collectedByName);
  }

  returnToCourier(societyId: string, guard: AuthenticatedUser, id: string) {
    return this.close(societyId, guard, id, ParcelStatus.RETURNED);
  }

  /**
   * Ends a parcel's stay at the gate. One atomic update that only succeeds while the parcel
   * is still held, so two guards pressing at once, or a replay, cannot close it twice.
   */
  private async close(societyId: string, guard: AuthenticatedUser, id: string, to: 'COLLECTED' | 'RETURNED', collectedByName?: string) {
    const now = new Date();
    const claimed = await this.prisma.parcel.updateMany({
      where: { id, societyId, status: ParcelStatus.RECEIVED },
      data: { status: to, closedAt: now, closedById: guard.id, ...(to === 'COLLECTED' ? { collectedByName: collectedByName || null } : {}) },
    });
    const parcel = await this.prisma.parcel.findFirst({ where: { id, societyId }, include: { flat: { select: { flatCode: true } } } });
    if (!parcel) throw new NotFoundException('Parcel not found');

    if (claimed.count === 0) {
      // Pressing the same button twice is harmless: the second press just shows the parcel as it is.
      if (parcel.status === to) return this.publicParcel(parcel);
      throw new ConflictException(parcel.status === ParcelStatus.COLLECTED ? 'This parcel was already handed over.' : 'This parcel was already sent back.');
    }
    await this.audit(societyId, guard.id, 'Parcel', id, { status: 'RECEIVED' }, {
      action: to === 'COLLECTED' ? 'PARCEL_HANDED_OVER' : 'PARCEL_RETURNED',
      flatCode: parcel.flat.flatCode,
      ...(to === 'COLLECTED' && collectedByName ? { collectedByName } : {}),
    });
    return this.publicParcel(parcel);
  }

  // ── Committee: the log ────────────────────────────────────────────────────

  async adminLog(
    societyId: string,
    q: { page?: number; limit?: number; from?: string; to?: string; status?: ParcelStatus; flatId?: string; search?: string },
  ) {
    const { skip, take, page, limit } = getPaginationParams({ page: q.page ?? 1, limit: q.limit ?? 25 });
    const from = q.from ? istDayStartUtc(q.from) : null;
    const to = q.to ? istDayStartUtc(q.to) : null;
    const term = q.search?.trim();
    const where: Prisma.ParcelWhereInput = {
      societyId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.flatId ? { flatId: q.flatId } : {}),
      ...(from || to ? { receivedAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 24 * HOUR) } : {}) } } : {}),
      ...(term
        ? {
            OR: [
              { courier: { contains: term, mode: 'insensitive' as const } },
              { recipientName: { contains: term, mode: 'insensitive' as const } },
              { flat: { flatCode: { contains: term, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.parcel.findMany({ where, include: { flat: { select: { flatCode: true } } }, orderBy: { receivedAt: 'desc' }, skip, take }),
      this.prisma.parcel.count({ where }),
    ]);

    const actorIds = [...new Set(rows.flatMap((r) => [r.receivedById, r.closedById]).filter((x): x is string => !!x))];
    const people = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const nameOf = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]));

    return {
      data: rows.map((r) => ({
        ...this.publicParcel(r),
        receivedBy: r.receivedById ? nameOf.get(r.receivedById) ?? null : null,
        closedBy: r.closedById ? nameOf.get(r.closedById) ?? null : null,
      })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** Household actions belong to the people who live there; gate staff are refused even if their account carries a flat. */
  private requireFlat(user: AuthenticatedUser): string {
    if (user.currentRole === SystemRole.SECURITY_GUARD) {
      throw new ForbiddenException('Gate staff cannot use household delivery actions. Use the gate screen.');
    }
    if (!user.flatId) throw new ForbiddenException('Only members who belong to a flat can use delivery instructions.');
    return user.flatId;
  }

  private findByClientRequest(societyId: string, clientRequestId: string) {
    return this.prisma.parcel.findFirst({ where: { societyId, clientRequestId }, include: { flat: { select: { flatCode: true } } } });
  }

  private async residentIdsOfFlat(societyId: string, flatId: string): Promise<string[]> {
    const rows = await this.prisma.societyMembership.findMany({
      where: { societyId, flatId, status: 'ACTIVE', role: { not: SystemRole.SECURITY_GUARD } },
      select: { userId: true },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }

  private publicExpectation(row: DeliveryExpectation, now: Date) {
    return { ...row, state: expectationState(row, now) };
  }

  private publicParcel(parcel: Parcel & { flat?: { flatCode: string } }) {
    const { flat, ...rest } = parcel;
    const copy: Partial<Parcel> = { ...rest };
    delete copy.clientRequestId; // the guard's retry token is not for display
    return { ...(copy as Omit<Parcel, 'clientRequestId'>), flatCode: flat?.flatCode ?? null };
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
