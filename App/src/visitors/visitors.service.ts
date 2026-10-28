import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  Prisma,
  SystemRole,
  VisitorEntry,
  VisitorEntryStatus,
  VisitorInvitation,
  VisitorInvitationStatus,
  VisitorType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { buildPaginationMeta, getPaginationParams } from '../common/utils/pagination';
import { istDayStartUtc, istDateString } from '../amenities/amenity-time';
import {
  CreateInvitationDto,
  OverrideDto,
  ScanCodeDto,
  UpdateVisitorPolicyDto,
  WalkInDto,
} from './dto/visitor.dto';
import { formatCode, generateCode, hashCode, normalizeCode } from './visitor-code';
import { VisitorPolicy, readPolicy } from './visitor-policy';

const MINUTE = 60_000;
/** A start time a little in the past is tolerated (clock skew, a form left open); further back is clamped to now. */
const START_GRACE_MS = 5 * MINUTE;
const OPEN_STATUSES: VisitorEntryStatus[] = [
  VisitorEntryStatus.PENDING_APPROVAL,
  VisitorEntryStatus.APPROVED,
  VisitorEntryStatus.CHECKED_IN,
];

export type InvitationState = 'ACTIVE' | 'NOT_YET' | 'USED' | 'EXPIRED' | 'REVOKED';

/** What a person looking at an invitation should see: its status, with time and use folded in. */
export function invitationState(inv: Pick<VisitorInvitation, 'status' | 'validFrom' | 'validUntil' | 'usedCount' | 'maxUses'>, now: Date): InvitationState {
  if (inv.status === VisitorInvitationStatus.REVOKED) return 'REVOKED';
  if (now > inv.validUntil) return 'EXPIRED';
  if (inv.usedCount >= inv.maxUses) return 'USED';
  if (now < inv.validFrom) return 'NOT_YET';
  return 'ACTIVE';
}

@Injectable()
export class VisitorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Policy ────────────────────────────────────────────────────────────────

  async getPolicy(societyId: string): Promise<VisitorPolicy> {
    const row = await this.prisma.societyConfiguration.findUnique({ where: { societyId }, select: { additionalConfig: true } });
    return readPolicy(row?.additionalConfig);
  }

  async updatePolicy(societyId: string, dto: UpdateVisitorPolicyDto, actorId: string): Promise<VisitorPolicy> {
    const row = await this.prisma.societyConfiguration.findUnique({ where: { societyId }, select: { additionalConfig: true } });
    const existing = (row?.additionalConfig as Record<string, unknown> | null) ?? {};
    const before = readPolicy(existing);
    const next: VisitorPolicy = {
      walkInApproval: dto.walkInApproval ?? before.walkInApproval,
      maxInviteDays: dto.maxInviteDays ?? before.maxInviteDays,
      maxUsesPerInvite: dto.maxUsesPerInvite ?? before.maxUsesPerInvite,
      approvalWindowMinutes: dto.approvalWindowMinutes ?? before.approvalWindowMinutes,
    };
    const additionalConfig = { ...existing, visitorPolicy: next } as unknown as Prisma.InputJsonValue;
    await this.prisma.societyConfiguration.upsert({
      where: { societyId },
      create: { societyId, additionalConfig },
      update: { additionalConfig },
    });
    await this.audit(this.prisma, societyId, actorId, 'SocietyConfiguration', societyId, before as unknown as Record<string, unknown>, {
      action: 'VISITOR_POLICY_UPDATED',
      ...next,
    });
    return next;
  }

  // ── Resident: invitations ─────────────────────────────────────────────────

  /**
   * A resident pre-approves a guest. The flat is taken from the resident's own
   * membership, never from the request, so an invitation can only ever admit
   * someone to the inviter's own flat.
   */
  async createInvitation(societyId: string, user: AuthenticatedUser, dto: CreateInvitationDto) {
    const flatId = this.requireFlat(user);
    const policy = await this.getPolicy(societyId);
    const now = new Date();

    const requestedFrom = dto.validFrom ? new Date(dto.validFrom) : now;
    const validUntil = new Date(dto.validUntil);
    if (Number.isNaN(requestedFrom.getTime()) || Number.isNaN(validUntil.getTime())) {
      throw new BadRequestException('Those dates are not valid.');
    }
    const validFrom = requestedFrom.getTime() < now.getTime() - START_GRACE_MS ? now : requestedFrom;
    if (validUntil <= now) throw new BadRequestException('That end time has already passed.');
    if (validUntil <= validFrom) throw new BadRequestException('The invitation must end after it starts.');
    if (validUntil.getTime() - validFrom.getTime() > policy.maxInviteDays * 24 * 60 * MINUTE) {
      throw new BadRequestException(`An invitation can last at most ${policy.maxInviteDays} day(s).`);
    }
    const maxUses = dto.maxUses ?? 1;
    if (maxUses > policy.maxUsesPerInvite) {
      throw new BadRequestException(`An invitation can admit at most ${policy.maxUsesPerInvite} entries.`);
    }

    const flat = await this.prisma.flat.findFirst({ where: { id: flatId, societyId, isActive: true, deletedAt: null }, select: { id: true } });
    if (!flat) throw new ForbiddenException('Your flat could not be found in this society.');

    // The code is random; a collision on the unique hash is astronomically unlikely, but handled.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateCode();
      try {
        const invitation = await this.prisma.visitorInvitation.create({
          data: {
            societyId,
            flatId,
            createdById: user.id,
            visitorName: dto.visitorName,
            visitorPhone: dto.visitorPhone ?? null,
            visitorType: dto.visitorType ?? VisitorType.GUEST,
            note: dto.note || null,
            validFrom,
            validUntil,
            maxUses,
            codeHash: hashCode(code),
          },
        });
        await this.audit(this.prisma, societyId, user.id, 'VisitorInvitation', invitation.id, null, {
          action: 'VISITOR_INVITED',
          visitorName: invitation.visitorName,
          validUntil: invitation.validUntil.toISOString(),
          maxUses,
        });
        // The code is returned here and nowhere else, ever.
        return { ...this.publicInvitation(invitation, now), code: formatCode(code) };
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      }
    }
    throw new ConflictException('Could not create the invitation. Please try again.');
  }

  async myInvitations(societyId: string, user: AuthenticatedUser) {
    const flatId = this.requireFlat(user);
    const now = new Date();
    const rows = await this.prisma.visitorInvitation.findMany({
      where: { societyId, flatId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => this.publicInvitation(r, now));
  }

  /** Any member of the same flat may withdraw an invitation made from it. */
  async revokeInvitation(societyId: string, user: AuthenticatedUser, id: string) {
    const flatId = this.requireFlat(user);
    const now = new Date();
    const claimed = await this.prisma.visitorInvitation.updateMany({
      where: { id, societyId, flatId, status: VisitorInvitationStatus.ACTIVE },
      data: { status: VisitorInvitationStatus.REVOKED, revokedAt: now, revokedById: user.id },
    });
    if (claimed.count === 0) {
      const existing = await this.prisma.visitorInvitation.findFirst({ where: { id, societyId, flatId } });
      if (!existing) throw new NotFoundException('Invitation not found');
      throw new ConflictException('This invitation was already cancelled.');
    }
    await this.audit(this.prisma, societyId, user.id, 'VisitorInvitation', id, { status: 'ACTIVE' }, { action: 'VISITOR_INVITATION_REVOKED' });
    const inv = await this.prisma.visitorInvitation.findUniqueOrThrow({ where: { id } });
    return this.publicInvitation(inv, now);
  }

  // ── Resident: visitors at my flat ─────────────────────────────────────────

  async myVisitors(societyId: string, user: AuthenticatedUser, status?: VisitorEntryStatus) {
    const flatId = this.requireFlat(user);
    await this.expireStale(societyId);
    const rows = await this.prisma.visitorEntry.findMany({
      where: { societyId, flatId, ...(status ? { status } : {}) },
      orderBy: { requestedAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => this.publicEntry(r));
  }

  /**
   * A resident answers a request for THEIR flat. The decision is one atomic
   * update that only succeeds while the request is still waiting and inside
   * the approval window, so two household members answering at once, a late
   * answer, or a replay cannot produce a second or contradictory decision.
   */
  async decide(societyId: string, user: AuthenticatedUser, id: string, approve: boolean, note?: string) {
    const flatId = this.requireFlat(user);
    const policy = await this.getPolicy(societyId);
    const now = new Date();
    const cutoff = new Date(now.getTime() - policy.approvalWindowMinutes * MINUTE);

    const claimed = await this.prisma.visitorEntry.updateMany({
      where: { id, societyId, flatId, status: VisitorEntryStatus.PENDING_APPROVAL, requestedAt: { gte: cutoff } },
      data: {
        status: approve ? VisitorEntryStatus.APPROVED : VisitorEntryStatus.REJECTED,
        decidedAt: now,
        decidedById: user.id,
        decisionNote: note || null,
        decisionMethod: 'RESIDENT',
      },
    });

    if (claimed.count === 0) {
      // Same answer for "not found" and "somebody else's flat": a resident learns nothing about other flats.
      const entry = await this.prisma.visitorEntry.findFirst({ where: { id, societyId, flatId } });
      if (!entry) throw new NotFoundException('Visitor request not found');
      if (entry.status === VisitorEntryStatus.PENDING_APPROVAL) {
        await this.prisma.visitorEntry.updateMany({
          where: { id, status: VisitorEntryStatus.PENDING_APPROVAL },
          data: { status: VisitorEntryStatus.EXPIRED },
        });
        throw new ConflictException('This request has expired. The guard can register the visitor again.');
      }
      if (entry.status === VisitorEntryStatus.EXPIRED) throw new ConflictException('This request has expired. The guard can register the visitor again.');
      throw new ConflictException('This request has already been answered.');
    }

    const entry = await this.prisma.visitorEntry.findUniqueOrThrow({ where: { id }, include: { flat: { select: { flatCode: true } } } });
    await this.audit(this.prisma, societyId, user.id, 'VisitorEntry', id, { status: 'PENDING_APPROVAL' }, {
      action: approve ? 'VISITOR_APPROVED' : 'VISITOR_REJECTED',
      method: 'RESIDENT',
      flatCode: entry.flat.flatCode,
    });
    await this.notifyGate(societyId, {
      title: approve ? `Approved: ${entry.visitorName}` : `Declined: ${entry.visitorName}`,
      body: approve ? `Let them in to ${entry.flat.flatCode}.` : `${entry.flat.flatCode} declined this visitor.`,
      type: 'VISITOR_DECISION',
      data: { entryId: id },
    });
    return this.publicEntry(entry);
  }

  // ── Gate (guard, or committee acting as guard) ────────────────────────────

  /** Flats the guard can pick, with no resident names: the guard needs a destination, not a directory. */
  async lookupFlats(societyId: string, search?: string) {
    const term = search?.trim();
    const flats = await this.prisma.flat.findMany({
      where: {
        societyId,
        isActive: true,
        deletedAt: null,
        ...(term ? { flatCode: { contains: term, mode: 'insensitive' as const } } : {}),
      },
      select: { id: true, flatCode: true, building: { select: { name: true } } },
      orderBy: { flatCode: 'asc' },
      take: 20,
    });
    return flats.map((f) => ({ id: f.id, flatCode: f.flatCode, buildingName: f.building?.name ?? null }));
  }

  /**
   * Registers someone who arrived without an invitation. Retried safely: the
   * same clientRequestId returns the entry already created instead of a
   * second one (and a second set of notifications).
   */
  async registerWalkIn(societyId: string, guard: AuthenticatedUser, dto: WalkInDto) {
    const existing = await this.findByClientRequest(societyId, dto.clientRequestId);
    if (existing) return { entry: this.publicEntry(existing), duplicate: true, notifiedResidents: 0 };

    const flat = await this.prisma.flat.findFirst({
      where: { id: dto.flatId, societyId, isActive: true, deletedAt: null },
      select: { id: true, flatCode: true },
    });
    if (!flat) throw new NotFoundException('That flat does not exist in this society.');

    const policy = await this.getPolicy(societyId);
    const needsApproval = policy.walkInApproval === 'REQUIRED';
    const now = new Date();

    let entry: VisitorEntry;
    try {
      entry = await this.prisma.visitorEntry.create({
        data: {
          societyId,
          flatId: flat.id,
          visitorName: dto.visitorName,
          visitorPhone: dto.visitorPhone ?? null,
          visitorType: dto.visitorType ?? VisitorType.GUEST,
          vehicleNumber: dto.vehicleNumber ? dto.vehicleNumber.toUpperCase() : null,
          purpose: dto.purpose || null,
          registeredById: guard.id,
          clientRequestId: dto.clientRequestId,
          requestedAt: now,
          ...(needsApproval
            ? { status: VisitorEntryStatus.PENDING_APPROVAL }
            : { status: VisitorEntryStatus.APPROVED, decidedAt: now, decisionMethod: 'POLICY' }),
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.findByClientRequest(societyId, dto.clientRequestId);
        if (raced) return { entry: this.publicEntry(raced), duplicate: true, notifiedResidents: 0 };
      }
      throw err;
    }

    await this.audit(this.prisma, societyId, guard.id, 'VisitorEntry', entry.id, null, {
      action: 'VISITOR_REGISTERED',
      flatCode: flat.flatCode,
      visitorType: entry.visitorType,
      approval: needsApproval ? 'REQUIRED' : 'NOT_REQUIRED',
    });

    const residents = await this.residentIdsOfFlat(societyId, flat.id);
    await this.notifications.notifyQuietly(async () => {
      await this.notifications.sendToUsers(societyId, residents, {
        title: needsApproval ? 'Visitor at the gate' : 'Visitor arrived',
        body: needsApproval
          ? `${entry.visitorName} (${entry.visitorType.toLowerCase()}) wants to visit ${flat.flatCode}. Approve or decline.`
          : `${entry.visitorName} (${entry.visitorType.toLowerCase()}) is coming to ${flat.flatCode}.`,
        type: needsApproval ? 'VISITOR_REQUEST' : 'VISITOR_ARRIVED',
        data: { entryId: entry.id },
      });
    }, `visitor ${entry.id} registered`);

    return { entry: this.publicEntry(entry), duplicate: false, notifiedResidents: residents.length };
  }

  /**
   * Checks an invitation code at the gate and, if it is good, admits the
   * visitor. The whole decision is ONE atomic UPDATE: the code must match in
   * THIS society, be un-revoked, inside its window and below its use limit,
   * and it counts the use in the same statement. Two guards scanning at once,
   * or a replay of a spent code, cannot both succeed. The use and the entry
   * are written in one transaction, so a failure leaves neither.
   */
  async scanCode(societyId: string, guard: AuthenticatedUser, dto: ScanCodeDto) {
    const existing = await this.findByClientRequest(societyId, dto.clientRequestId);
    if (existing) return { entry: this.publicEntry(existing), duplicate: true };

    const code = normalizeCode(dto.code);
    if (!code) throw new BadRequestException('That is not a valid code. Check it and try again.');
    const codeHash = hashCode(code);
    const now = new Date();

    try {
      const entry = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<{ id: string; flatId: string; visitorName: string; visitorPhone: string | null; visitorType: VisitorType; createdById: string }[]>(
          Prisma.sql`
            UPDATE "visitor_invitations"
               SET "usedCount" = "usedCount" + 1, "updatedAt" = NOW()
             WHERE "codeHash" = ${codeHash}
               AND "societyId" = ${societyId}
               AND "status" = 'ACTIVE'
               AND "validFrom" <= ${now}
               AND "validUntil" >= ${now}
               AND "usedCount" < "maxUses"
            RETURNING "id", "flatId", "visitorName", "visitorPhone", "visitorType", "createdById"`,
        );
        if (rows.length === 0) return null;
        const inv = rows[0];
        return tx.visitorEntry.create({
          data: {
            societyId,
            flatId: inv.flatId,
            invitationId: inv.id,
            visitorName: inv.visitorName,
            visitorPhone: inv.visitorPhone,
            visitorType: inv.visitorType,
            status: VisitorEntryStatus.CHECKED_IN,
            requestedAt: now,
            decidedAt: now,
            decisionMethod: 'INVITATION',
            checkedInAt: now,
            checkedInById: guard.id,
            registeredById: guard.id,
            clientRequestId: dto.clientRequestId,
          },
        });
      });

      if (!entry) throw await this.whyCodeFailed(societyId, codeHash, now);

      const flat = await this.prisma.flat.findUnique({ where: { id: entry.flatId }, select: { flatCode: true } });
      await this.audit(this.prisma, societyId, guard.id, 'VisitorEntry', entry.id, null, {
        action: 'VISITOR_CHECKED_IN',
        method: 'INVITATION',
        flatCode: flat?.flatCode,
      });
      const inviter = await this.prisma.visitorInvitation.findUnique({ where: { id: entry.invitationId! }, select: { createdById: true } });
      if (inviter) {
        await this.notifications.notifyQuietly(async () => {
          await this.notifications.sendToUsers(societyId, [inviter.createdById], {
            title: 'Your guest has arrived',
            body: `${entry.visitorName} has checked in at the gate.`,
            type: 'VISITOR_ARRIVED',
            data: { entryId: entry.id },
          });
        }, `visitor ${entry.id} invitation used`);
      }
      return { entry: this.publicEntry(entry), duplicate: false };
    } catch (err) {
      // A racing retry of the same attempt lost on the unique clientRequestId; the transaction rolled back, so no use was spent.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.findByClientRequest(societyId, dto.clientRequestId);
        if (raced) return { entry: this.publicEntry(raced), duplicate: true };
      }
      throw err;
    }
  }

  async checkIn(societyId: string, guard: AuthenticatedUser, id: string) {
    const now = new Date();
    const claimed = await this.prisma.visitorEntry.updateMany({
      where: { id, societyId, status: VisitorEntryStatus.APPROVED },
      data: { status: VisitorEntryStatus.CHECKED_IN, checkedInAt: now, checkedInById: guard.id },
    });
    const entry = await this.prisma.visitorEntry.findFirst({ where: { id, societyId }, include: { flat: { select: { flatCode: true } } } });
    if (!entry) throw new NotFoundException('Visitor not found');

    if (claimed.count === 0) {
      // Pressing "let in" twice is harmless: the second press just shows the entry as it is.
      if (entry.status === VisitorEntryStatus.CHECKED_IN) return this.publicEntry(entry);
      if (entry.status === VisitorEntryStatus.PENDING_APPROVAL) throw new ConflictException('Still waiting for the resident to approve this visitor.');
      if (entry.status === VisitorEntryStatus.REJECTED) throw new ConflictException('The resident declined this visitor.');
      if (entry.status === VisitorEntryStatus.EXPIRED) throw new ConflictException('This request expired without an answer.');
      throw new ConflictException('This visitor has already left.');
    }

    await this.audit(this.prisma, societyId, guard.id, 'VisitorEntry', id, { status: 'APPROVED' }, {
      action: 'VISITOR_CHECKED_IN',
      method: entry.decisionMethod,
      flatCode: entry.flat.flatCode,
    });
    return this.publicEntry(entry);
  }

  async checkOut(societyId: string, guard: AuthenticatedUser, id: string) {
    const now = new Date();
    const claimed = await this.prisma.visitorEntry.updateMany({
      where: { id, societyId, status: VisitorEntryStatus.CHECKED_IN },
      data: { status: VisitorEntryStatus.CHECKED_OUT, checkedOutAt: now, checkedOutById: guard.id },
    });
    const entry = await this.prisma.visitorEntry.findFirst({ where: { id, societyId }, include: { flat: { select: { flatCode: true } } } });
    if (!entry) throw new NotFoundException('Visitor not found');

    if (claimed.count === 0) {
      if (entry.status === VisitorEntryStatus.CHECKED_OUT) return this.publicEntry(entry);
      throw new ConflictException('This visitor has not been let in, so they cannot be checked out.');
    }
    await this.audit(this.prisma, societyId, guard.id, 'VisitorEntry', id, { status: 'CHECKED_IN' }, {
      action: 'VISITOR_CHECKED_OUT',
      flatCode: entry.flat.flatCode,
    });
    return this.publicEntry(entry);
  }

  /** What the guard needs today: everything still open, plus anything that arrived since midnight (India time). */
  async gateList(societyId: string, search?: string) {
    await this.expireStale(societyId);
    const todayStart = istDayStartUtc(istDateString(new Date())) ?? new Date(Date.now() - 24 * 60 * MINUTE);
    const term = search?.trim();
    const rows = await this.prisma.visitorEntry.findMany({
      where: {
        societyId,
        OR: [{ status: { in: OPEN_STATUSES } }, { requestedAt: { gte: todayStart } }],
        ...(term
          ? {
              AND: [
                {
                  OR: [
                    { visitorName: { contains: term, mode: 'insensitive' as const } },
                    { visitorPhone: { contains: term } },
                    { vehicleNumber: { contains: term, mode: 'insensitive' as const } },
                    { flat: { flatCode: { contains: term, mode: 'insensitive' as const } } },
                  ],
                },
              ],
            }
          : {}),
      },
      include: { flat: { select: { flatCode: true } } },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.publicEntry(r));
  }

  // ── Committee: the log, and overrides ─────────────────────────────────────

  async adminLog(
    societyId: string,
    q: { page?: number; limit?: number; from?: string; to?: string; status?: VisitorEntryStatus; flatId?: string; visitorType?: VisitorType; search?: string },
  ) {
    await this.expireStale(societyId);
    const { skip, take, page, limit } = getPaginationParams({ page: q.page ?? 1, limit: q.limit ?? 25 });
    const from = q.from ? istDayStartUtc(q.from) : null;
    const to = q.to ? istDayStartUtc(q.to) : null;
    const term = q.search?.trim();
    const where: Prisma.VisitorEntryWhereInput = {
      societyId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.flatId ? { flatId: q.flatId } : {}),
      ...(q.visitorType ? { visitorType: q.visitorType } : {}),
      ...(from || to ? { requestedAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + 24 * 60 * MINUTE) } : {}) } } : {}),
      ...(term
        ? {
            OR: [
              { visitorName: { contains: term, mode: 'insensitive' as const } },
              { visitorPhone: { contains: term } },
              { vehicleNumber: { contains: term, mode: 'insensitive' as const } },
              { flat: { flatCode: { contains: term, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.visitorEntry.findMany({
        where,
        include: { flat: { select: { flatCode: true } } },
        orderBy: { requestedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.visitorEntry.count({ where }),
    ]);

    // Who acted: names for the guards and residents behind the ids, in one lookup.
    const actorIds = [...new Set(rows.flatMap((r) => [r.registeredById, r.decidedById, r.checkedInById, r.checkedOutById]).filter((x): x is string => !!x))];
    const people = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const nameOf = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]));

    return {
      data: rows.map((r) => ({
        ...this.publicEntry(r),
        registeredBy: r.registeredById ? nameOf.get(r.registeredById) ?? null : null,
        decidedBy: r.decidedById ? nameOf.get(r.decidedById) ?? null : null,
        checkedInBy: r.checkedInById ? nameOf.get(r.checkedInById) ?? null : null,
        checkedOutBy: r.checkedOutById ? nameOf.get(r.checkedOutById) ?? null : null,
      })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  /**
   * The committee decides a request nobody answered (or an expired one), with a
   * recorded reason. It is an exception, so it is always audited and the
   * residents of the flat are told it happened.
   */
  async override(societyId: string, admin: AuthenticatedUser, id: string, dto: OverrideDto) {
    const approve = dto.action === 'APPROVE';
    const now = new Date();
    const claimed = await this.prisma.visitorEntry.updateMany({
      where: { id, societyId, status: { in: [VisitorEntryStatus.PENDING_APPROVAL, VisitorEntryStatus.EXPIRED] } },
      data: {
        status: approve ? VisitorEntryStatus.APPROVED : VisitorEntryStatus.REJECTED,
        decidedAt: now,
        decidedById: admin.id,
        decisionNote: dto.reason,
        decisionMethod: 'ADMIN_OVERRIDE',
      },
    });
    const entry = await this.prisma.visitorEntry.findFirst({ where: { id, societyId }, include: { flat: { select: { flatCode: true } } } });
    if (!entry) throw new NotFoundException('Visitor not found');
    if (claimed.count === 0) throw new ConflictException('This visit has already been decided, so it cannot be overridden.');

    await this.audit(this.prisma, societyId, admin.id, 'VisitorEntry', id, { status: 'PENDING_APPROVAL' }, {
      action: 'VISITOR_OVERRIDE',
      decision: dto.action,
      reason: dto.reason,
      flatCode: entry.flat.flatCode,
    });

    const residents = await this.residentIdsOfFlat(societyId, entry.flatId);
    await this.notifications.notifyQuietly(async () => {
      await this.notifications.sendToUsers(societyId, residents, {
        title: approve ? 'A visitor was approved by the committee' : 'A visitor was declined by the committee',
        body: `${entry.visitorName} for ${entry.flat.flatCode}: ${dto.reason}`,
        type: 'VISITOR_OVERRIDE',
        data: { entryId: id },
      });
    }, `visitor ${id} override`);
    await this.notifyGate(societyId, {
      title: approve ? `Approved: ${entry.visitorName}` : `Declined: ${entry.visitorName}`,
      body: `Committee decision for ${entry.flat.flatCode}.`,
      type: 'VISITOR_DECISION',
      data: { entryId: id },
    });
    return this.publicEntry(entry);
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private requireFlat(user: AuthenticatedUser): string {
    if (!user.flatId) throw new ForbiddenException('Only members who belong to a flat can use visitor invitations.');
    return user.flatId;
  }

  private findByClientRequest(societyId: string, clientRequestId: string) {
    return this.prisma.visitorEntry.findFirst({ where: { societyId, clientRequestId }, include: { flat: { select: { flatCode: true } } } });
  }

  /** Requests nobody answered in time stop being answerable. Run before any list or decision. */
  private async expireStale(societyId: string) {
    const policy = await this.getPolicy(societyId);
    const cutoff = new Date(Date.now() - policy.approvalWindowMinutes * MINUTE);
    await this.prisma.visitorEntry.updateMany({
      where: { societyId, status: VisitorEntryStatus.PENDING_APPROVAL, requestedAt: { lt: cutoff } },
      data: { status: VisitorEntryStatus.EXPIRED },
    });
  }

  private async residentIdsOfFlat(societyId: string, flatId: string): Promise<string[]> {
    const rows = await this.prisma.societyMembership.findMany({
      where: { societyId, flatId, status: 'ACTIVE', role: { not: SystemRole.SECURITY_GUARD } },
      select: { userId: true },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }

  private async notifyGate(societyId: string, payload: { title: string; body: string; type: string; data: Record<string, unknown> }) {
    await this.notifications.notifyQuietly(async () => {
      const guards = await this.prisma.societyMembership.findMany({
        where: { societyId, status: 'ACTIVE', role: SystemRole.SECURITY_GUARD },
        select: { userId: true },
      });
      const ids = [...new Set(guards.map((g) => g.userId))];
      if (ids.length) await this.notifications.sendToUsers(societyId, ids, payload);
    }, 'visitor gate notice');
  }

  /** The specific reason a code was refused, so the guard can tell the visitor what to do. */
  private async whyCodeFailed(societyId: string, codeHash: string, now: Date): Promise<Error> {
    const inv = await this.prisma.visitorInvitation.findFirst({ where: { codeHash, societyId } });
    if (!inv) return new BadRequestException('That code is not valid for this society.');
    switch (invitationState(inv, now)) {
      case 'REVOKED':
        return new ConflictException('The resident cancelled this invitation.');
      case 'EXPIRED':
        return new ConflictException('This invitation has expired.');
      case 'USED':
        return new ConflictException('This invitation has already been used.');
      case 'NOT_YET':
        return new ConflictException('This invitation is not valid yet.');
      default:
        return new ConflictException('This invitation could not be used. Please try again.');
    }
  }

  /** An invitation as its owner should see it: no hash, with its state worked out. */
  private publicInvitation(inv: VisitorInvitation, now: Date) {
    const copy: Partial<VisitorInvitation> = { ...inv };
    delete copy.codeHash; // the hash never leaves the server
    return { ...(copy as Omit<VisitorInvitation, 'codeHash'>), state: invitationState(inv, now) };
  }

  private publicEntry(entry: VisitorEntry & { flat?: { flatCode: string } }) {
    const { flat, ...rest } = entry;
    const copy: Partial<VisitorEntry> = { ...rest };
    delete copy.clientRequestId; // the guard's retry token is not for display
    return { ...(copy as Omit<VisitorEntry, 'clientRequestId'>), flatCode: flat?.flatCode ?? null };
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
