import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, DomesticHelper, DomesticHelperVisit, HelperStatus, Prisma, SystemRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { buildPaginationMeta, getPaginationParams } from '../common/utils/pagination';
import { istDayStartUtc, istDateString } from '../amenities/amenity-time';
import { formatCode, generateCode, normalizeCode } from '../visitors/visitor-code';
import { AddHelperDto, HelperCodeDto, SuspendHelperDto } from './dto/helper.dto';
import { HELPER_LIMITS, helperCodeHash, normalizePhone } from './helper-rules';

const DAY = 24 * 3_600_000;
const ROLE_WORD: Record<string, string> = { MAID: 'maid', COOK: 'cook', DRIVER: 'driver', NANNY: 'nanny', CLEANER: 'cleaner', GARDENER: 'gardener', OTHER: 'helper' };

type HelperWithFlats = DomesticHelper & { flats: { active: boolean; flat: { flatCode: string } }[]; visits?: DomesticHelperVisit[] };

@Injectable()
export class HelpersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Resident: my household's help ─────────────────────────────────────────

  /**
   * Adds someone who works in the resident's home. A person is one record per society: if the
   * phone number is already on the register (another flat added them), this flat is linked to
   * that person and no new pass code is made — the code belongs to the person and is shown only
   * when it is created. The flat is the resident's own, never taken from the request.
   */
  async addHelper(societyId: string, user: AuthenticatedUser, dto: AddHelperDto) {
    const flatId = this.requireFlat(user);
    const phone = dto.phone === undefined ? null : normalizePhone(dto.phone);
    if (dto.phone !== undefined && !phone) throw new BadRequestException('That is not a valid mobile number.');

    const flat = await this.prisma.flat.findFirst({ where: { id: flatId, societyId, isActive: true, deletedAt: null }, select: { id: true } });
    if (!flat) throw new ForbiddenException('Your flat could not be found in this society.');

    if (phone) {
      const existing = await this.prisma.domesticHelper.findUnique({ where: { societyId_phone: { societyId, phone } } });
      if (existing) return this.linkExisting(societyId, user, flatId, existing.id);
    }

    // The code is random; a collision on the unique hash is astronomically unlikely, but handled.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateCode();
      try {
        const helper = await this.prisma.$transaction(async (tx) => {
          const created = await tx.domesticHelper.create({
            data: { societyId, name: dto.name, phone, role: dto.role, codeHash: helperCodeHash(code), createdById: user.id },
          });
          await tx.domesticHelperFlat.create({ data: { societyId, helperId: created.id, flatId, addedById: user.id } });
          return created;
        });
        await this.audit(societyId, user.id, 'DomesticHelper', helper.id, null, { action: 'HELPER_ADDED', role: helper.role });
        // The code is returned here (and from a new-code request) and nowhere else, ever.
        return { helper: this.publicHelper(helper), code: formatCode(code), linked: false };
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          const target = JSON.stringify(err.meta?.target ?? '');
          // Two adds of the same phone raced: the loser joins the winner's record instead of failing.
          if (phone && target.includes('phone')) {
            const winner = await this.prisma.domesticHelper.findUnique({ where: { societyId_phone: { societyId, phone } } });
            if (winner) return this.linkExisting(societyId, user, flatId, winner.id);
          }
          continue;
        }
        throw err;
      }
    }
    throw new ConflictException('Could not add this person. Please try again.');
  }

  private async linkExisting(societyId: string, user: AuthenticatedUser, flatId: string, helperId: string) {
    const link = await this.prisma.domesticHelperFlat.findUnique({ where: { helperId_flatId: { helperId, flatId } } });
    if (link?.active) throw new ConflictException('This person is already on your list.');
    if (link) {
      await this.prisma.domesticHelperFlat.update({ where: { id: link.id }, data: { active: true, addedById: user.id } });
    } else {
      await this.prisma.domesticHelperFlat.create({ data: { societyId, helperId, flatId, addedById: user.id } });
    }
    await this.audit(societyId, user.id, 'DomesticHelper', helperId, null, { action: 'HELPER_LINKED' });
    const helper = await this.prisma.domesticHelper.findUniqueOrThrow({ where: { id: helperId } });
    return { helper: this.publicHelper(helper), linked: true };
  }

  async myHelpers(societyId: string, user: AuthenticatedUser) {
    const flatId = this.requireFlat(user);
    const links = await this.prisma.domesticHelperFlat.findMany({
      where: { societyId, flatId, active: true },
      include: { helper: { include: { visits: { orderBy: { checkedInAt: 'desc' }, take: 1 } } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return links.map((l) => {
      const last = l.helper.visits[0] ?? null;
      return {
        ...this.publicHelper(l.helper),
        inside: !!last && last.checkedOutAt === null,
        lastVisitAt: last?.checkedInAt ?? null,
      };
    });
  }

  /** Ends this flat's link. The person stays on the register for any other flat they work for, and their history is kept. */
  async removeHelper(societyId: string, user: AuthenticatedUser, helperId: string) {
    const flatId = this.requireFlat(user);
    const claimed = await this.prisma.domesticHelperFlat.updateMany({ where: { societyId, helperId, flatId, active: true }, data: { active: false } });
    if (claimed.count === 0) throw new NotFoundException('Helper not found');
    await this.audit(societyId, user.id, 'DomesticHelper', helperId, { active: true }, { action: 'HELPER_UNLINKED' });
    return { removed: true };
  }

  /** A fresh pass code, for a person who lost theirs. The old one stops working at once. Shown once. */
  async newCode(societyId: string, user: AuthenticatedUser, helperId: string) {
    const flatId = this.requireFlat(user);
    await this.requireLink(societyId, flatId, helperId);
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateCode();
      try {
        await this.prisma.domesticHelper.update({ where: { id: helperId }, data: { codeHash: helperCodeHash(code) } });
        await this.audit(societyId, user.id, 'DomesticHelper', helperId, null, { action: 'HELPER_CODE_REISSUED' });
        return { code: formatCode(code) };
      } catch (err) {
        if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      }
    }
    throw new ConflictException('Could not make a new code. Please try again.');
  }

  /** The recent comings and goings of someone this household employs. */
  async helperVisits(societyId: string, user: AuthenticatedUser, helperId: string) {
    const flatId = this.requireFlat(user);
    await this.requireLink(societyId, flatId, helperId);
    const since = new Date(Date.now() - HELPER_LIMITS.visitDays * DAY);
    const rows = await this.prisma.domesticHelperVisit.findMany({
      where: { societyId, helperId, checkedInAt: { gte: since } },
      orderBy: { checkedInAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => this.publicVisit(r));
  }

  // ── Gate ──────────────────────────────────────────────────────────────────

  /** Everyone the guard may let in, with the flats they work for (codes only: a guard needs a destination, not a directory). */
  async gateHelpers(societyId: string, search?: string) {
    const term = search?.trim();
    const rows = await this.prisma.domesticHelper.findMany({
      where: {
        societyId,
        flats: { some: { active: true } },
        ...(term
          ? {
              OR: [
                { name: { contains: term, mode: 'insensitive' as const } },
                { flats: { some: { active: true, flat: { flatCode: { contains: term, mode: 'insensitive' as const } } } } },
              ],
            }
          : {}),
      },
      include: {
        flats: { where: { active: true }, select: { active: true, flat: { select: { flatCode: true } } } },
        visits: { orderBy: { checkedInAt: 'desc' }, take: 1 },
      },
      orderBy: { name: 'asc' },
      take: 50,
    });
    return rows.map((h) => ({
      id: h.id,
      name: h.name,
      role: h.role,
      status: h.status,
      verified: !!h.verifiedAt,
      flatCodes: this.flatCodes(h),
      inside: h.visits[0]?.checkedOutAt === null && !!h.visits[0],
    }));
  }

  /** Who is inside now, plus everyone who came today (India time). */
  async gateVisits(societyId: string) {
    const todayStart = istDayStartUtc(istDateString(new Date())) ?? new Date(Date.now() - DAY);
    const rows = await this.prisma.domesticHelperVisit.findMany({
      where: { societyId, OR: [{ checkedOutAt: null }, { checkedInAt: { gte: todayStart } }] },
      include: { helper: { include: { flats: { where: { active: true }, select: { active: true, flat: { select: { flatCode: true } } } } } } },
      orderBy: { checkedInAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => ({ ...this.publicVisit(r), name: r.helper.name, role: r.helper.role, flatCodes: this.flatCodes(r.helper) }));
  }

  async checkInById(societyId: string, guard: AuthenticatedUser, helperId: string, clientRequestId: string) {
    const helper = await this.prisma.domesticHelper.findFirst({ where: { id: helperId, societyId } });
    if (!helper) throw new NotFoundException('That person is not on this society’s register.');
    return this.enter(societyId, guard, helper, 'GUARD', clientRequestId);
  }

  async checkInByCode(societyId: string, guard: AuthenticatedUser, dto: HelperCodeDto) {
    const code = normalizeCode(dto.code);
    if (!code) throw new BadRequestException('That is not a valid code. Check it and try again.');
    const helper = await this.prisma.domesticHelper.findFirst({ where: { societyId, codeHash: helperCodeHash(code) } });
    if (!helper) throw new BadRequestException('That code is not valid for this society.');
    return this.enter(societyId, guard, helper, 'CODE', dto.clientRequestId);
  }

  /**
   * Lets a helper in. Safe to retry (same clientRequestId returns the same visit). A helper can be
   * inside only once: the database allows one open visit each, so two guards letting the same person
   * in at once cannot both succeed; the second is told they are already inside. A visit left open
   * from an earlier day (nobody recorded the exit) is closed first and flagged, never silently
   * given a made-up exit time.
   */
  private async enter(societyId: string, guard: AuthenticatedUser, helper: DomesticHelper, method: 'GUARD' | 'CODE', clientRequestId: string) {
    // What the guard sees back: the visit, and who it was, so they can match the face to the name.
    const done = async (visit: DomesticHelperVisit, duplicate: boolean, alreadyInside: boolean) => ({
      visit: this.publicVisit(visit),
      duplicate,
      alreadyInside,
      helper: await this.helperCard(societyId, helper.id),
    });

    const again = await this.findByClientRequest(societyId, clientRequestId);
    if (again) return done(again, true, false);

    if (helper.status === HelperStatus.SUSPENDED) {
      throw new ForbiddenException('The committee has suspended this person. Do not let them in.');
    }
    const links = await this.prisma.domesticHelperFlat.findMany({
      where: { societyId, helperId: helper.id, active: true },
      select: { flatId: true },
    });
    if (links.length === 0) throw new ConflictException('No flat has this person on its list any more. Ask a resident to add them.');

    const now = new Date();
    const todayStart = istDayStartUtc(istDateString(now)) ?? new Date(now.getTime() - DAY);
    let visit: DomesticHelperVisit;
    try {
      visit = await this.prisma.$transaction(async (tx) => {
        const stale = await tx.domesticHelperVisit.findMany({ where: { helperId: helper.id, checkedOutAt: null, checkedInAt: { lt: todayStart } } });
        for (const s of stale) {
          await tx.domesticHelperVisit.update({ where: { id: s.id }, data: { checkedOutAt: s.checkedInAt, autoClosed: true } });
        }
        return tx.domesticHelperVisit.create({
          data: { societyId, helperId: helper.id, checkedInAt: now, checkedInById: guard.id, method, clientRequestId },
        });
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const raced = await this.findByClientRequest(societyId, clientRequestId);
        if (raced) return done(raced, true, false);
        const open = await this.prisma.domesticHelperVisit.findFirst({ where: { helperId: helper.id, checkedOutAt: null } });
        if (open) return done(open, false, true);
      }
      throw err;
    }

    await this.audit(societyId, guard.id, 'DomesticHelperVisit', visit.id, null, { action: 'HELPER_CHECKED_IN', helperId: helper.id, method });
    const residents = await this.residentIdsOfFlats(societyId, links.map((l) => l.flatId));
    await this.notifications.notifyQuietly(async () => {
      await this.notifications.sendToUsers(societyId, residents, {
        title: `${helper.name} has arrived`,
        body: `Your ${ROLE_WORD[helper.role] ?? 'helper'} checked in at the gate.`,
        type: 'HELPER_ARRIVED',
        data: { helperId: helper.id },
      });
    }, `helper ${helper.id} arrived`);
    return done(visit, false, false);
  }

  /** One atomic update that only succeeds while the visit is open, so two guards pressing at once cannot both close it. */
  async checkOut(societyId: string, guard: AuthenticatedUser, visitId: string) {
    const now = new Date();
    const claimed = await this.prisma.domesticHelperVisit.updateMany({
      where: { id: visitId, societyId, checkedOutAt: null },
      data: { checkedOutAt: now, checkedOutById: guard.id },
    });
    const visit = await this.prisma.domesticHelperVisit.findFirst({ where: { id: visitId, societyId } });
    if (!visit) throw new NotFoundException('Visit not found');
    // Pressing "left" twice is harmless: the second press just shows the visit as it is.
    if (claimed.count === 0) return this.publicVisit(visit);
    await this.audit(societyId, guard.id, 'DomesticHelperVisit', visitId, { checkedOutAt: null }, { action: 'HELPER_CHECKED_OUT' });
    return this.publicVisit(visit);
  }

  // ── Committee ─────────────────────────────────────────────────────────────

  async adminList(societyId: string, q: { page?: number; limit?: number; status?: HelperStatus; search?: string }) {
    const { skip, take, page, limit } = getPaginationParams({ page: q.page ?? 1, limit: q.limit ?? 25 });
    const term = q.search?.trim();
    const where: Prisma.DomesticHelperWhereInput = {
      societyId,
      ...(q.status ? { status: q.status } : {}),
      ...(term
        ? {
            OR: [
              { name: { contains: term, mode: 'insensitive' as const } },
              { phone: { contains: term.replace(/\D/g, '') || term } },
              { flats: { some: { flat: { flatCode: { contains: term, mode: 'insensitive' as const } } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.domesticHelper.findMany({
        where,
        include: {
          flats: { where: { active: true }, select: { active: true, flat: { select: { flatCode: true } } } },
          visits: { orderBy: { checkedInAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.domesticHelper.count({ where }),
    ]);
    return {
      data: rows.map((h) => ({
        ...this.publicHelper(h),
        flatCodes: this.flatCodes(h),
        inside: !!h.visits[0] && h.visits[0].checkedOutAt === null,
        lastVisitAt: h.visits[0]?.checkedInAt ?? null,
      })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async verify(societyId: string, admin: AuthenticatedUser, helperId: string) {
    const claimed = await this.prisma.domesticHelper.updateMany({
      where: { id: helperId, societyId, verifiedAt: null },
      data: { verifiedAt: new Date(), verifiedById: admin.id },
    });
    const helper = await this.prisma.domesticHelper.findFirst({ where: { id: helperId, societyId } });
    if (!helper) throw new NotFoundException('Helper not found');
    if (claimed.count > 0) await this.audit(societyId, admin.id, 'DomesticHelper', helperId, { verified: false }, { action: 'HELPER_VERIFIED' });
    return this.publicHelper(helper);
  }

  async suspend(societyId: string, admin: AuthenticatedUser, helperId: string, dto: SuspendHelperDto) {
    const claimed = await this.prisma.domesticHelper.updateMany({
      where: { id: helperId, societyId, status: HelperStatus.ACTIVE },
      data: { status: HelperStatus.SUSPENDED, suspendedAt: new Date(), suspendedById: admin.id, suspendedReason: dto.reason },
    });
    const helper = await this.prisma.domesticHelper.findFirst({ where: { id: helperId, societyId } });
    if (!helper) throw new NotFoundException('Helper not found');
    if (claimed.count === 0) throw new ConflictException('This person is already suspended.');

    await this.audit(societyId, admin.id, 'DomesticHelper', helperId, { status: 'ACTIVE' }, { action: 'HELPER_SUSPENDED', reason: dto.reason });
    const links = await this.prisma.domesticHelperFlat.findMany({ where: { societyId, helperId, active: true }, select: { flatId: true } });
    const residents = await this.residentIdsOfFlats(societyId, links.map((l) => l.flatId));
    await this.notifications.notifyQuietly(async () => {
      await this.notifications.sendToUsers(societyId, residents, {
        title: `${helper.name} was suspended`,
        body: `The committee will not let them in at the gate: ${dto.reason}`,
        type: 'HELPER_SUSPENDED',
        data: { helperId },
      });
    }, `helper ${helperId} suspended`);
    return this.publicHelper(helper);
  }

  async reinstate(societyId: string, admin: AuthenticatedUser, helperId: string) {
    const claimed = await this.prisma.domesticHelper.updateMany({
      where: { id: helperId, societyId, status: HelperStatus.SUSPENDED },
      data: { status: HelperStatus.ACTIVE, suspendedAt: null, suspendedById: null, suspendedReason: null },
    });
    const helper = await this.prisma.domesticHelper.findFirst({ where: { id: helperId, societyId } });
    if (!helper) throw new NotFoundException('Helper not found');
    if (claimed.count === 0) throw new ConflictException('This person is not suspended.');
    await this.audit(societyId, admin.id, 'DomesticHelper', helperId, { status: 'SUSPENDED' }, { action: 'HELPER_REINSTATED' });
    return this.publicHelper(helper);
  }

  async adminVisits(societyId: string, q: { page?: number; limit?: number; from?: string; to?: string; helperId?: string; search?: string }) {
    const { skip, take, page, limit } = getPaginationParams({ page: q.page ?? 1, limit: q.limit ?? 25 });
    const from = q.from ? istDayStartUtc(q.from) : null;
    const to = q.to ? istDayStartUtc(q.to) : null;
    const term = q.search?.trim();
    const where: Prisma.DomesticHelperVisitWhereInput = {
      societyId,
      ...(q.helperId ? { helperId: q.helperId } : {}),
      ...(from || to ? { checkedInAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: new Date(to.getTime() + DAY) } : {}) } } : {}),
      ...(term ? { helper: { name: { contains: term, mode: 'insensitive' as const } } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.domesticHelperVisit.findMany({
        where,
        include: { helper: { include: { flats: { where: { active: true }, select: { active: true, flat: { select: { flatCode: true } } } } } } },
        orderBy: { checkedInAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.domesticHelperVisit.count({ where }),
    ]);
    const actorIds = [...new Set(rows.flatMap((r) => [r.checkedInById, r.checkedOutById]).filter((x): x is string => !!x))];
    const people = actorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const nameOf = new Map(people.map((p) => [p.id, `${p.firstName} ${p.lastName}`.trim()]));
    return {
      data: rows.map((r) => ({
        ...this.publicVisit(r),
        name: r.helper.name,
        role: r.helper.role,
        flatCodes: this.flatCodes(r.helper),
        checkedInBy: r.checkedInById ? nameOf.get(r.checkedInById) ?? null : null,
        checkedOutBy: r.checkedOutById ? nameOf.get(r.checkedOutById) ?? null : null,
      })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** Household actions belong to the people who live there; gate staff are refused even if their account carries a flat. */
  private requireFlat(user: AuthenticatedUser): string {
    if (user.currentRole === SystemRole.SECURITY_GUARD) {
      throw new ForbiddenException('Gate staff cannot use household help actions. Use the gate screen.');
    }
    if (!user.flatId) throw new ForbiddenException('Only members who belong to a flat can manage household help.');
    return user.flatId;
  }

  /** The same answer for "no such helper" and "somebody else's helper". */
  private async requireLink(societyId: string, flatId: string, helperId: string) {
    const link = await this.prisma.domesticHelperFlat.findFirst({ where: { societyId, flatId, helperId, active: true }, select: { id: true } });
    if (!link) throw new NotFoundException('Helper not found');
  }

  private findByClientRequest(societyId: string, clientRequestId: string) {
    return this.prisma.domesticHelperVisit.findFirst({ where: { societyId, clientRequestId } });
  }

  private async residentIdsOfFlats(societyId: string, flatIds: string[]): Promise<string[]> {
    if (flatIds.length === 0) return [];
    const rows = await this.prisma.societyMembership.findMany({
      where: { societyId, flatId: { in: flatIds }, status: 'ACTIVE', role: { not: SystemRole.SECURITY_GUARD } },
      select: { userId: true },
    });
    return [...new Set(rows.map((r) => r.userId))];
  }

  private async helperCard(societyId: string, helperId: string) {
    const h = await this.prisma.domesticHelper.findFirstOrThrow({
      where: { id: helperId, societyId },
      select: { id: true, name: true, role: true, flats: { where: { active: true }, select: { active: true, flat: { select: { flatCode: true } } } } },
    });
    return { id: h.id, name: h.name, role: h.role, flatCodes: this.flatCodes(h) };
  }

  private flatCodes(h: Pick<HelperWithFlats, 'flats'>): string[] {
    return h.flats.filter((f) => f.active).map((f) => f.flat.flatCode).sort();
  }

  /** A helper as the household or committee should see it: never the code hash. */
  private publicHelper(h: DomesticHelper) {
    const copy: Partial<DomesticHelper> = { ...h };
    delete copy.codeHash;
    return { ...(copy as Omit<DomesticHelper, 'codeHash'>), verified: !!h.verifiedAt };
  }

  private publicVisit(v: DomesticHelperVisit) {
    const copy: Partial<DomesticHelperVisit> = { ...v };
    delete copy.clientRequestId; // the guard's retry token is not for display
    return copy as Omit<DomesticHelperVisit, 'clientRequestId'>;
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
