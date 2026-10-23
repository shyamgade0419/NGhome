import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AmenityBookingMode,
  AmenityBookingStatus,
  AmenityFeeStatus,
  AuditAction,
  Prisma,
  SystemRole,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { buildPaginationMeta, getPaginationParams } from '../common/utils/pagination';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { CreateAmenityDto, UpdateAmenityDto } from './dto/amenity.dto';
import { CreateBookingDto } from './dto/booking.dto';
import {
  SlotRules,
  checkBookingWindow,
  generateSlots,
  istDayStartUtc,
  istMonthRangeUtc,
} from './amenity-time';

const LIVE: AmenityBookingStatus[] = [AmenityBookingStatus.PENDING, AmenityBookingStatus.CONFIRMED];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type SlotState = 'AVAILABLE' | 'FULL' | 'PAST' | 'TOO_FAR';

function formatIst(d: Date): string {
  return d.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/** Closing after opening, and at least one full slot — and a maximum-length booking — fitting in the day. */
function assertRulesValid(r: SlotRules & { maxSlotsPerBooking: number }): void {
  if (r.closesAtMin <= r.opensAtMin) {
    throw new BadRequestException('Closing time must be after opening time.');
  }
  if (r.slotMinutes > r.closesAtMin - r.opensAtMin) {
    throw new BadRequestException('A slot is longer than the time the amenity is open.');
  }
  if (r.maxSlotsPerBooking * r.slotMinutes > r.closesAtMin - r.opensAtMin) {
    throw new BadRequestException('The longest allowed booking does not fit within opening hours.');
  }
}

@Injectable()
export class AmenitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Amenities (committee manages, everyone reads) ─────────────────────────

  async listAmenities(societyId: string, includeInactive: boolean) {
    return this.prisma.amenity.findMany({
      where: { societyId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: { name: 'asc' },
    });
  }

  async createAmenity(societyId: string, dto: CreateAmenityDto, actorId: string) {
    const data = {
      name: dto.name.trim(),
      description: dto.description?.trim() || null,
      rules: dto.rules?.trim() || null,
      bookingMode: dto.bookingMode ?? AmenityBookingMode.INSTANT,
      slotMinutes: dto.slotMinutes ?? 60,
      opensAtMin: dto.opensAtMin ?? 360,
      closesAtMin: dto.closesAtMin ?? 1320,
      maxAdvanceDays: dto.maxAdvanceDays ?? 30,
      monthlyCapPerFlat: dto.monthlyCapPerFlat ?? null,
      cancelBeforeHours: dto.cancelBeforeHours ?? 24,
      capacity: dto.capacity ?? 1,
      maxSlotsPerBooking: dto.maxSlotsPerBooking ?? 1,
      fee: dto.fee && dto.fee > 0 ? new Prisma.Decimal(dto.fee) : null,
    };
    assertRulesValid(data);

    const amenity = await this.prisma.amenity.create({ data: { societyId, ...data } });
    await this.audit(this.prisma, societyId, actorId, 'Amenity', amenity.id, null, {
      action: 'AMENITY_CREATED',
      name: amenity.name,
    });
    return amenity;
  }

  async updateAmenity(societyId: string, id: string, dto: UpdateAmenityDto, actorId: string) {
    const existing = await this.prisma.amenity.findFirst({ where: { id, societyId } });
    if (!existing) throw new NotFoundException('Amenity not found');

    const merged = {
      slotMinutes: dto.slotMinutes ?? existing.slotMinutes,
      opensAtMin: dto.opensAtMin ?? existing.opensAtMin,
      closesAtMin: dto.closesAtMin ?? existing.closesAtMin,
      maxSlotsPerBooking: dto.maxSlotsPerBooking ?? existing.maxSlotsPerBooking,
    };
    assertRulesValid(merged);

    // Existing bookings are left exactly as they are: a rule change applies to
    // new bookings only, never rewrites or cancels what residents already hold.
    const amenity = await this.prisma.amenity.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.description !== undefined && { description: dto.description.trim() || null }),
        ...(dto.rules !== undefined && { rules: dto.rules.trim() || null }),
        ...(dto.bookingMode !== undefined && { bookingMode: dto.bookingMode }),
        ...(dto.slotMinutes !== undefined && { slotMinutes: dto.slotMinutes }),
        ...(dto.opensAtMin !== undefined && { opensAtMin: dto.opensAtMin }),
        ...(dto.closesAtMin !== undefined && { closesAtMin: dto.closesAtMin }),
        ...(dto.maxAdvanceDays !== undefined && { maxAdvanceDays: dto.maxAdvanceDays }),
        ...(dto.monthlyCapPerFlat !== undefined && { monthlyCapPerFlat: dto.monthlyCapPerFlat }),
        ...(dto.cancelBeforeHours !== undefined && { cancelBeforeHours: dto.cancelBeforeHours }),
        ...(dto.capacity !== undefined && { capacity: dto.capacity }),
        ...(dto.maxSlotsPerBooking !== undefined && { maxSlotsPerBooking: dto.maxSlotsPerBooking }),
        ...(dto.fee !== undefined && { fee: dto.fee > 0 ? new Prisma.Decimal(dto.fee) : null }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
    await this.audit(this.prisma, societyId, actorId, 'Amenity', id, null, {
      action: 'AMENITY_UPDATED',
      changed: Object.keys(dto),
    });
    return amenity;
  }

  // ── Availability ──────────────────────────────────────────────────────────

  async getAvailability(societyId: string, amenityId: string, dateStr: string, viewerFlatId?: string) {
    const amenity = await this.prisma.amenity.findFirst({ where: { id: amenityId, societyId, isActive: true } });
    if (!amenity) throw new NotFoundException('Amenity not found');

    const dayStart = istDayStartUtc(dateStr);
    if (!dayStart) throw new BadRequestException('date must be a real date like 2026-11-04.');
    const dayEnd = new Date(dayStart.getTime() + MS_PER_DAY);

    const bookings = await this.prisma.amenityBooking.findMany({
      where: { amenityId, status: { in: LIVE }, startAt: { lt: dayEnd }, endAt: { gt: dayStart } },
      select: { startAt: true, endAt: true, flatId: true },
    });

    const now = new Date();
    const horizon = new Date(now.getTime() + amenity.maxAdvanceDays * MS_PER_DAY);

    const slots = generateSlots(amenity, dateStr).map((slot) => {
      const overlapping = bookings.filter((b) => b.startAt < slot.endAt && b.endAt > slot.startAt);
      const remaining = Math.max(0, amenity.capacity - overlapping.length);
      let state: SlotState = 'AVAILABLE';
      if (slot.startAt <= now) state = 'PAST';
      else if (slot.startAt > horizon) state = 'TOO_FAR';
      else if (remaining === 0) state = 'FULL';
      return {
        startAt: slot.startAt,
        endAt: slot.endAt,
        remaining,
        state,
        bookedByMyFlat: viewerFlatId ? overlapping.some((b) => b.flatId === viewerFlatId) : false,
      };
    });

    return { amenityId, date: dateStr, slots };
  }

  // ── Booking ───────────────────────────────────────────────────────────────

  async book(societyId: string, user: AuthenticatedUser, dto: CreateBookingDto) {
    // flatId is read from the signed-in membership server-side, never from the
    // request body — a resident cannot book on another flat's behalf.
    const flatId = user.flatId;
    if (!flatId) throw new ForbiddenException('Only residents who belong to a flat can book an amenity.');

    const amenity = await this.prisma.amenity.findFirst({ where: { id: dto.amenityId, societyId, isActive: true } });
    if (!amenity) throw new NotFoundException('Amenity not found');

    const slotCount = dto.slots ?? 1;
    if (slotCount > amenity.maxSlotsPerBooking) {
      throw new BadRequestException(`You can book at most ${amenity.maxSlotsPerBooking} slot(s) at a time.`);
    }

    const startAt = new Date(dto.startAt);
    const window = checkBookingWindow(amenity, startAt, slotCount);
    if (!window.ok) throw new BadRequestException(window.reason);
    const endAt = window.endAt;

    const now = new Date();
    if (startAt <= now) throw new BadRequestException('That time has already passed.');
    if (startAt.getTime() > now.getTime() + amenity.maxAdvanceDays * MS_PER_DAY) {
      throw new BadRequestException(`Bookings open ${amenity.maxAdvanceDays} days ahead.`);
    }

    const fee = amenity.fee ?? new Prisma.Decimal(0);
    const status =
      amenity.bookingMode === AmenityBookingMode.NEEDS_APPROVAL
        ? AmenityBookingStatus.PENDING
        : AmenityBookingStatus.CONFIRMED;

    const booking = await this.prisma.$transaction(async (tx) => {
      // The amenity row is locked for the rest of this transaction, so two
      // residents tapping the same slot at the same instant are serialised:
      // the second sees the first's booking when it counts overlaps. Counting
      // alone would let both succeed, since neither could see the other's
      // uncommitted insert.
      await tx.$queryRaw`SELECT id FROM amenities WHERE id = ${amenity.id} FOR UPDATE`;

      if (amenity.monthlyCapPerFlat) {
        const month = istMonthRangeUtc(startAt);
        const held = await tx.amenityBooking.count({
          where: {
            amenityId: amenity.id,
            flatId,
            status: { in: LIVE },
            startAt: { gte: month.start, lt: month.end },
          },
        });
        if (held >= amenity.monthlyCapPerFlat) {
          throw new BadRequestException(
            `Your flat has reached the limit of ${amenity.monthlyCapPerFlat} booking(s) a month for this amenity.`,
          );
        }
      }

      const overlapping = await tx.amenityBooking.count({
        where: { amenityId: amenity.id, status: { in: LIVE }, startAt: { lt: endAt }, endAt: { gt: startAt } },
      });
      if (overlapping >= amenity.capacity) {
        throw new ConflictException('That slot was just taken — please pick another.');
      }

      const created = await tx.amenityBooking.create({
        data: {
          societyId,
          amenityId: amenity.id,
          flatId,
          userId: user.id,
          startAt,
          endAt,
          status,
          guestCount: dto.guestCount ?? 0,
          note: dto.note?.trim() || null,
          feeAmount: fee,
          feeStatus: fee.gt(0) ? AmenityFeeStatus.DUE : AmenityFeeStatus.NONE,
        },
        include: { amenity: { select: { id: true, name: true } } },
      });
      await this.audit(tx, societyId, user.id, 'AmenityBooking', created.id, null, {
        action: 'BOOKING_CREATED',
        status,
      });
      return created;
    });

    if (status === AmenityBookingStatus.PENDING) {
      await this.notifications.notifyQuietly(async () => {
        await this.notifications.sendToUsers(societyId, await this.committeeIds(societyId), {
          title: `Booking request: ${amenity.name}`,
          body: `${user.firstName} ${user.lastName} — ${formatIst(startAt)}. Open Bookings to approve or decline.`,
          type: 'AMENITY_BOOKING',
          data: { bookingId: booking.id },
        });
      }, `amenity booking ${booking.id} request`);
    }

    return booking;
  }

  async myBookings(societyId: string, user: AuthenticatedUser, page = 1, limit = 50) {
    if (!user.flatId) return { data: [], meta: buildPaginationMeta(0, 1, limit) };
    // By flat, not by person: a household shares what it has booked, the same
    // way payments and bills are already scoped to the flat.
    const where = { societyId, flatId: user.flatId };
    return this.pageBookings(where, page, limit);
  }

  async listBookings(
    societyId: string,
    filters: { status?: AmenityBookingStatus; amenityId?: string; page: number; limit: number },
  ) {
    return this.pageBookings(
      {
        societyId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.amenityId ? { amenityId: filters.amenityId } : {}),
      },
      filters.page,
      filters.limit,
    );
  }

  private async pageBookings(where: Prisma.AmenityBookingWhereInput, page: number, limit: number) {
    const { skip, take, page: p, limit: l } = getPaginationParams({ page, limit });
    const [data, total] = await Promise.all([
      this.prisma.amenityBooking.findMany({
        where,
        skip,
        take,
        orderBy: { startAt: 'desc' },
        include: {
          amenity: { select: { id: true, name: true } },
          flat: { select: { id: true, flatCode: true } },
          user: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      this.prisma.amenityBooking.count({ where }),
    ]);
    return { data, meta: buildPaginationMeta(total, p, l) };
  }

  async cancel(societyId: string, user: AuthenticatedUser, id: string, isCommittee: boolean) {
    const booking = await this.prisma.amenityBooking.findFirst({
      where: { id, societyId },
      include: { amenity: { select: { name: true, cancelBeforeHours: true } } },
    });
    // Another flat's booking is "not found", not "forbidden" — a resident
    // should not be able to confirm that someone else's booking id exists.
    if (!booking || (!isCommittee && booking.flatId !== user.flatId)) {
      throw new NotFoundException('Booking not found');
    }
    if (!LIVE.includes(booking.status)) throw new BadRequestException('This booking is already closed.');

    const now = new Date();
    if (booking.startAt <= now) throw new BadRequestException('This booking has already started.');
    if (!isCommittee) {
      const cutoff = booking.startAt.getTime() - booking.amenity.cancelBeforeHours * 60 * 60 * 1000;
      if (now.getTime() > cutoff) {
        throw new BadRequestException(
          `Bookings can only be cancelled at least ${booking.amenity.cancelBeforeHours} hour(s) before they start. Please contact the committee.`,
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.amenityBooking.updateMany({
        where: { id, societyId, status: { in: LIVE } },
        data: { status: AmenityBookingStatus.CANCELLED, cancelledAt: now, cancelledById: user.id },
      });
      if (claimed.count === 0) throw new ConflictException('This booking was just changed — please refresh.');

      // A fee that was never collected is simply no longer owed. A collected
      // one is left as COLLECTED: refunding money is the committee's call and
      // is not something this endpoint silently does.
      if (booking.feeStatus === AmenityFeeStatus.DUE) {
        await tx.amenityBooking.updateMany({
          where: { id, feeStatus: AmenityFeeStatus.DUE },
          data: { feeStatus: AmenityFeeStatus.NONE },
        });
      }
      await this.audit(tx, societyId, user.id, 'AmenityBooking', id, { status: booking.status }, {
        action: 'BOOKING_CANCELLED',
        by: isCommittee ? 'committee' : 'resident',
      });
    });

    await this.notifications.notifyQuietly(async () => {
      if (isCommittee && booking.userId !== user.id) {
        await this.notifications.sendToUsers(societyId, [booking.userId], {
          title: `Booking cancelled: ${booking.amenity.name}`,
          body: `Your booking for ${formatIst(booking.startAt)} was cancelled by the committee.`,
          type: 'AMENITY_BOOKING',
          data: { bookingId: id },
        });
      } else if (!isCommittee && booking.status === AmenityBookingStatus.CONFIRMED) {
        await this.notifications.sendToUsers(societyId, await this.committeeIds(societyId), {
          title: `Booking cancelled: ${booking.amenity.name}`,
          body: `${formatIst(booking.startAt)} is free again.`,
          type: 'AMENITY_BOOKING',
          data: { bookingId: id },
        });
      }
    }, `amenity booking ${id} cancelled`);

    return { id, status: AmenityBookingStatus.CANCELLED };
  }

  // ── Committee decisions ───────────────────────────────────────────────────

  async approve(societyId: string, id: string, actorId: string) {
    return this.decide(societyId, id, actorId, AmenityBookingStatus.CONFIRMED);
  }

  async reject(societyId: string, id: string, actorId: string, reason?: string) {
    return this.decide(societyId, id, actorId, AmenityBookingStatus.REJECTED, reason?.trim() || undefined);
  }

  private async decide(
    societyId: string,
    id: string,
    actorId: string,
    outcome: 'CONFIRMED' | 'REJECTED',
    reason?: string,
  ) {
    const booking = await this.prisma.amenityBooking.findFirst({
      where: { id, societyId },
      include: { amenity: { select: { name: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.startAt <= new Date()) throw new BadRequestException('This booking has already started.');

    // The status check lives in the WHERE of the update, not in a read above:
    // two committee members tapping Approve and Reject together cannot both win.
    const result = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.amenityBooking.updateMany({
        where: { id, societyId, status: AmenityBookingStatus.PENDING },
        data: {
          status: outcome,
          decidedById: actorId,
          decidedAt: new Date(),
          rejectionReason: outcome === 'REJECTED' ? reason ?? null : null,
          // A request that was turned down never owes its fee.
          ...(outcome === 'REJECTED' && booking.feeStatus === AmenityFeeStatus.DUE
            ? { feeStatus: AmenityFeeStatus.NONE }
            : {}),
        },
      });
      if (claimed.count === 0) throw new ConflictException('This request has already been decided.');
      await this.audit(tx, societyId, actorId, 'AmenityBooking', id, { status: booking.status }, {
        action: outcome === 'CONFIRMED' ? 'BOOKING_APPROVED' : 'BOOKING_REJECTED',
      });
      return tx.amenityBooking.findUnique({
        where: { id },
        include: { amenity: { select: { id: true, name: true } } },
      });
    });

    await this.notifications.notifyQuietly(async () => {
      await this.notifications.sendToUsers(societyId, [booking.userId], {
        title: outcome === 'CONFIRMED' ? `Booking confirmed: ${booking.amenity.name}` : `Booking declined: ${booking.amenity.name}`,
        body:
          outcome === 'CONFIRMED'
            ? `You're booked for ${formatIst(booking.startAt)}.`
            : `${formatIst(booking.startAt)} was declined${reason ? ` — ${reason}` : '.'}`,
        type: 'AMENITY_BOOKING',
        data: { bookingId: id },
      });
    }, `amenity booking ${id} decision`);

    return result;
  }

  // ── Fees ──────────────────────────────────────────────────────────────────

  /**
   * Records that a booking's fee was received into one of the society's
   * accounts — the credit-side mirror of ExpensesService.markPaid: the status
   * claim, the balance increment and the ledger row are one transaction, so a
   * fee can never be marked collected without the money landing, or twice.
   */
  async collectFee(societyId: string, id: string, accountId: string, actorId: string) {
    const booking = await this.prisma.amenityBooking.findFirst({
      where: { id, societyId },
      include: { amenity: { select: { name: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== AmenityBookingStatus.CONFIRMED) {
      throw new BadRequestException('A fee can only be collected for a confirmed booking.');
    }

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.amenityBooking.updateMany({
        where: { id, societyId, status: AmenityBookingStatus.CONFIRMED, feeStatus: AmenityFeeStatus.DUE },
        data: { feeStatus: AmenityFeeStatus.COLLECTED, collectedAccountId: accountId },
      });
      if (claimed.count === 0) throw new ConflictException('No fee is due on this booking.');

      const account = await tx.account.findFirst({ where: { id: accountId, societyId, isActive: true } });
      if (!account) throw new NotFoundException('Account not found');

      const updated = await tx.account.update({
        where: { id: accountId },
        data: { currentBalance: { increment: booking.feeAmount } },
      });
      await tx.transaction.create({
        data: {
          societyId,
          accountId,
          transactionType: 'CREDIT',
          amount: booking.feeAmount,
          transactionDate: new Date(),
          description: `Amenity fee: ${booking.amenity.name}`,
          linkedEntityType: 'AMENITY_BOOKING',
          linkedEntityId: id,
          balanceAfter: updated.currentBalance,
          createdById: actorId,
        },
      });
      await this.audit(tx, societyId, actorId, 'AmenityBooking', id, { feeStatus: 'DUE' }, {
        action: 'FEE_COLLECTED',
        accountId,
        amount: booking.feeAmount.toString(),
      });
      return tx.amenityBooking.findUnique({ where: { id } });
    });
  }

  async waiveFee(societyId: string, id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.amenityBooking.updateMany({
        where: { id, societyId, feeStatus: AmenityFeeStatus.DUE },
        data: { feeStatus: AmenityFeeStatus.WAIVED },
      });
      if (claimed.count === 0) throw new NotFoundException('No fee is due on this booking.');
      await this.audit(tx, societyId, actorId, 'AmenityBooking', id, { feeStatus: 'DUE' }, { action: 'FEE_WAIVED' });
      return tx.amenityBooking.findUnique({ where: { id } });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async committeeIds(societyId: string): Promise<string[]> {
    const rows = await this.prisma.societyMembership.findMany({
      where: {
        societyId,
        status: 'ACTIVE',
        role: { in: [SystemRole.SOCIETY_ADMIN, SystemRole.COMMITTEE_MEMBER] },
      },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.map((r) => r.userId);
  }

  private async audit(
    db: Pick<Prisma.TransactionClient, 'auditLog'>,
    societyId: string,
    actorId: string,
    entityType: string,
    entityId: string,
    oldValues: Record<string, unknown> | null,
    newValues: Record<string, unknown>,
  ) {
    await db.auditLog.create({
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
