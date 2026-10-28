/**
 * The gate's guarantees, run against a small in-memory database so the real
 * service code executes. One thing a fake cannot prove is the SQL itself, so
 * the scan statement's predicates are pinned by text below, and the tenant
 * e2e suite (which needs a real database) is the place to exercise it for real.
 */

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, SystemRole } from '@prisma/client';
import { VisitorsService, invitationState } from './visitors.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { hashCode, normalizeCode } from './visitor-code';

const SOCIETY = 'soc-1';
const OTHER_SOCIETY = 'soc-2';
const FLAT_A = 'flat-a';
const FLAT_B = 'flat-b';

const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser =>
  ({ id: 'res-a', email: 'a@x.com', firstName: 'Asha', lastName: 'Rao', isPlatformAdmin: false, societyId: SOCIETY, flatId: FLAT_A, currentRole: SystemRole.RESIDENT, ...over }) as AuthenticatedUser;
const guard = user({ id: 'guard-1', flatId: undefined, currentRole: SystemRole.SECURITY_GUARD });
const admin = user({ id: 'admin-1', flatId: undefined, currentRole: SystemRole.SOCIETY_ADMIN });

type Row = Record<string, any>;

// ── a tiny matcher for the Prisma `where` shapes the service uses ──────────
function matches(row: Row, where: Row | undefined, flats: Row[]): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w, flats));
    if (key === 'AND') return (cond as Row[]).every((w) => matches(row, w, flats));
    if (key === 'flat') return matches(flats.find((f) => f.id === row.flatId) ?? {}, cond, flats);
    const v = row[key];
    if (cond === null) return v === null || v === undefined;
    if (cond instanceof Date) return v instanceof Date && v.getTime() === cond.getTime();
    if (typeof cond === 'object') {
      const c = cond as Row;
      if ('in' in c && !(c.in as unknown[]).includes(v)) return false;
      if ('not' in c && v === c.not) return false;
      if ('gte' in c && !(v >= c.gte)) return false;
      if ('gt' in c && !(v > c.gt)) return false;
      if ('lte' in c && !(v <= c.lte)) return false;
      if ('lt' in c && !(v < c.lt)) return false;
      if ('contains' in c && !String(v ?? '').toLowerCase().includes(String(c.contains).toLowerCase())) return false;
      return true;
    }
    return v === cond;
  });
}

function build(opts: { policy?: Row; extraFlats?: Row[] } = {}) {
  let seq = 0;
  const db = {
    invitations: [] as Row[],
    entries: [] as Row[],
    flats: [
      { id: FLAT_A, societyId: SOCIETY, flatCode: 'A-403', isActive: true, deletedAt: null, building: { name: 'Block A' } },
      { id: FLAT_B, societyId: SOCIETY, flatCode: 'B-101', isActive: true, deletedAt: null, building: { name: 'Block B' } },
      { id: 'flat-x', societyId: OTHER_SOCIETY, flatCode: 'X-1', isActive: true, deletedAt: null, building: null },
      ...(opts.extraFlats ?? []),
    ] as Row[],
    memberships: [
      { userId: 'res-a', societyId: SOCIETY, flatId: FLAT_A, role: 'RESIDENT', status: 'ACTIVE' },
      { userId: 'res-a2', societyId: SOCIETY, flatId: FLAT_A, role: 'RESIDENT', status: 'ACTIVE' },
      { userId: 'res-b', societyId: SOCIETY, flatId: FLAT_B, role: 'RESIDENT', status: 'ACTIVE' },
      { userId: 'guard-1', societyId: SOCIETY, flatId: null, role: 'SECURITY_GUARD', status: 'ACTIVE' },
    ] as Row[],
    config: { additionalConfig: opts.policy ? { visitorPolicy: opts.policy } : {} } as Row,
    audits: [] as Row[],
    sent: [] as { userIds: string[]; payload: Row }[],
    rawCalls: [] as Prisma.Sql[],
  };

  const view = (r: Row, include?: Row) => (include?.flat ? { ...r, flat: { flatCode: db.flats.find((f) => f.id === r.flatId)?.flatCode } } : { ...r });
  const withDefaults = (data: Row, kind: 'inv' | 'entry'): Row => {
    const now = new Date();
    return kind === 'inv'
      ? { id: `inv-${++seq}`, usedCount: 0, status: 'ACTIVE', revokedAt: null, revokedById: null, createdAt: now, updatedAt: now, visitorPhone: null, note: null, ...data }
      : {
          id: `ent-${++seq}`, invitationId: null, visitorPhone: null, vehicleNumber: null, purpose: null, status: 'PENDING_APPROVAL', requestedAt: now,
          registeredById: null, decidedAt: null, decidedById: null, decisionNote: null, decisionMethod: null, checkedInAt: null, checkedInById: null,
          checkedOutAt: null, checkedOutById: null, clientRequestId: null, createdAt: now, updatedAt: now, ...data,
        };
  };
  const p2002 = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

  const model = (rows: Row[], kind: 'inv' | 'entry') => ({
    create: jest.fn(async ({ data }: Row) => {
      if (kind === 'inv' && rows.some((r) => r.codeHash === data.codeHash)) throw p2002();
      if (kind === 'entry' && data.clientRequestId && rows.some((r) => r.societyId === data.societyId && r.clientRequestId === data.clientRequestId)) throw p2002();
      const row = withDefaults(data, kind);
      rows.push(row);
      return { ...row };
    }),
    findMany: jest.fn(async ({ where, include, take }: Row = {}) => rows.filter((r) => matches(r, where, db.flats)).sort((a, b) => (b.requestedAt ?? b.createdAt) - (a.requestedAt ?? a.createdAt)).slice(0, take ?? 1e9).map((r) => view(r, include))),
    findFirst: jest.fn(async ({ where, include }: Row = {}) => {
      const r = rows.find((x) => matches(x, where, db.flats));
      return r ? view(r, include) : null;
    }),
    findUnique: jest.fn(async ({ where, include }: Row) => {
      const r = rows.find((x) => matches(x, where, db.flats));
      return r ? view(r, include) : null;
    }),
    findUniqueOrThrow: jest.fn(async ({ where, include }: Row) => {
      const r = rows.find((x) => matches(x, where, db.flats));
      if (!r) throw new Error('not found');
      return view(r, include);
    }),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const hit = rows.filter((r) => matches(r, where, db.flats));
      hit.forEach((r) => Object.assign(r, data, { updatedAt: new Date() }));
      return { count: hit.length };
    }),
    count: jest.fn(async ({ where }: Row = {}) => rows.filter((r) => matches(r, where, db.flats)).length),
  });

  const invitation = model(db.invitations, 'inv');
  const entry = model(db.entries, 'entry');

  const prisma: any = {
    visitorInvitation: invitation,
    visitorEntry: entry,
    flat: {
      findFirst: jest.fn(async ({ where }: Row) => db.flats.find((f) => matches(f, where, db.flats)) ?? null),
      findUnique: jest.fn(async ({ where }: Row) => db.flats.find((f) => f.id === where.id) ?? null),
      findMany: jest.fn(async ({ where, take }: Row) => db.flats.filter((f) => matches(f, where, db.flats)).slice(0, take)),
    },
    societyMembership: {
      findMany: jest.fn(async ({ where }: Row) => db.memberships.filter((m) => matches(m, where, db.flats))),
    },
    societyConfiguration: {
      findUnique: jest.fn(async () => db.config),
      upsert: jest.fn(async ({ update }: Row) => {
        db.config = { ...db.config, ...update };
        return db.config;
      }),
    },
    user: {
      findMany: jest.fn(async ({ where }: Row) =>
        (where.id.in as string[]).map((id) => ({ id, firstName: id === 'guard-1' ? 'Gopal' : 'Person', lastName: id })),
      ),
    },
    auditLog: { create: jest.fn(async ({ data }: Row) => void db.audits.push(data)) },
    // The scan statement. Applies the same rules the SQL states, using the values the service passes.
    $queryRaw: jest.fn(async (sql: Prisma.Sql) => {
      db.rawCalls.push(sql);
      const [codeHash, societyId, now1, now2] = sql.values as [string, string, Date, Date];
      const inv = db.invitations.find(
        (i) => i.codeHash === codeHash && i.societyId === societyId && i.status === 'ACTIVE' && i.validFrom <= now1 && i.validUntil >= now2 && i.usedCount < i.maxUses,
      );
      if (!inv) return [];
      inv.usedCount += 1;
      return [{ id: inv.id, flatId: inv.flatId, visitorName: inv.visitorName, visitorPhone: inv.visitorPhone, visitorType: inv.visitorType, createdById: inv.createdById }];
    }),
    // Rolls back on failure, so "the use and the entry are one unit" is testable.
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => {
      const snapshot = JSON.parse(JSON.stringify(db.invitations), (k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(v) : v));
      const entriesBefore = db.entries.length;
      try {
        return await fn(prisma);
      } catch (e) {
        db.invitations.splice(0, db.invitations.length, ...snapshot);
        db.entries.splice(entriesBefore);
        throw e;
      }
    }),
  };

  const notifications = {
    sendToUsers: jest.fn(async (_s: string, userIds: string[], payload: Row) => void db.sent.push({ userIds, payload })),
    notifyQuietly: jest.fn(async (fn: () => Promise<unknown>) => fn()),
  } as unknown as NotificationsService;

  const service = new VisitorsService(prisma as PrismaService, notifications);
  return { service, db, prisma };
}

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const invite = (over: Row = {}) => ({ visitorName: 'Ravi Kumar', validUntil: inHours(5), ...over });
const walkIn = (over: Row = {}) => ({ flatId: FLAT_A, visitorName: 'Cab Driver', clientRequestId: `req-${Math.random()}`, ...over });

// ═════════════════════════════════════════════════════════════════════════════

describe('invitationState', () => {
  const base = { status: 'ACTIVE', validFrom: new Date('2026-10-28T10:00Z'), validUntil: new Date('2026-10-28T12:00Z'), usedCount: 0, maxUses: 1 } as any;
  const at = (s: string) => new Date(`2026-10-28T${s}Z`);
  it.each([
    ['inside the window', base, '11:00', 'ACTIVE'],
    ['before it starts', base, '09:00', 'NOT_YET'],
    ['after it ends', base, '13:00', 'EXPIRED'],
    ['used up', { ...base, usedCount: 1 }, '11:00', 'USED'],
    ['cancelled', { ...base, status: 'REVOKED' }, '11:00', 'REVOKED'],
    ['cancelled and expired reads as cancelled', { ...base, status: 'REVOKED' }, '13:00', 'REVOKED'],
  ])('%s -> %s', (_n, inv, time, state) => expect(invitationState(inv, at(time))).toBe(state));
});

describe('createInvitation', () => {
  it('takes the flat from the resident\'s own sign-in, never from the request', async () => {
    const { service, db } = build();
    await service.createInvitation(SOCIETY, user(), invite({ flatId: FLAT_B, societyId: OTHER_SOCIETY } as any));
    expect(db.invitations[0]).toMatchObject({ flatId: FLAT_A, societyId: SOCIETY, createdById: 'res-a' });
  });

  it('returns the code once, and stores only its hash', async () => {
    const { service, db } = build();
    const out: any = await service.createInvitation(SOCIETY, user(), invite());
    expect(out.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(out).not.toHaveProperty('codeHash');
    expect(db.invitations[0].codeHash).toBe(hashCode(normalizeCode(out.code)!));
    expect(JSON.stringify(db.invitations)).not.toContain(normalizeCode(out.code)!);
  });

  it('never returns the code again from the list', async () => {
    const { service } = build();
    await service.createInvitation(SOCIETY, user(), invite());
    const list: any[] = await service.myInvitations(SOCIETY, user());
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('code');
    expect(list[0]).not.toHaveProperty('codeHash');
    expect(list[0].state).toBe('ACTIVE');
  });

  it('refuses someone with no flat (a guard or a flat-less admin)', async () => {
    const { service } = build();
    await expect(service.createInvitation(SOCIETY, guard, invite())).rejects.toThrow(ForbiddenException);
  });

  it.each([
    ['an end time in the past', { validUntil: new Date(Date.now() - 3_600_000).toISOString() }, /already passed/],
    ['an end before the start', { validFrom: inHours(4), validUntil: inHours(2) }, /end after/],
    ['longer than the society allows', { validUntil: inHours(24 * 8) }, /at most 7 day/],
    ['more entries than allowed', { maxUses: 11 }, /at most 10 entries/],
    ['a date that is not a date', { validUntil: 'soon' }, /not valid/],
  ])('refuses %s', async (_n, over, message) => {
    const { service, db } = build();
    await expect(service.createInvitation(SOCIETY, user(), invite(over))).rejects.toThrow(message as RegExp);
    expect(db.invitations).toHaveLength(0);
  });

  it('respects a society that allows longer invitations', async () => {
    const { service } = build({ policy: { maxInviteDays: 14 } });
    await expect(service.createInvitation(SOCIETY, user(), invite({ validUntil: inHours(24 * 10) }))).resolves.toBeDefined();
  });

  it('moves a start that is well in the past up to now', async () => {
    const { service, db } = build();
    await service.createInvitation(SOCIETY, user(), invite({ validFrom: inHours(-3) }));
    expect(db.invitations[0].validFrom.getTime()).toBeGreaterThan(Date.now() - 5_000);
  });

  it('records who invited whom', async () => {
    const { service, db } = build();
    await service.createInvitation(SOCIETY, user(), invite());
    expect(db.audits[0]).toMatchObject({ societyId: SOCIETY, actorId: 'res-a', entityType: 'VisitorInvitation' });
    expect(db.audits[0].newValues).toMatchObject({ action: 'VISITOR_INVITED', visitorName: 'Ravi Kumar' });
  });
});

describe('revokeInvitation', () => {
  it('lets the flat withdraw its own invitation, which then cannot be used', async () => {
    const { service } = build();
    const made: any = await service.createInvitation(SOCIETY, user(), invite());
    const out: any = await service.revokeInvitation(SOCIETY, user(), made.id);
    expect(out.state).toBe('REVOKED');
    await expect(service.scanCode(SOCIETY, guard, { code: made.code, clientRequestId: 'r1' })).rejects.toThrow(/cancelled/);
  });

  it('does not let another flat find or cancel it', async () => {
    const { service } = build();
    const made: any = await service.createInvitation(SOCIETY, user(), invite());
    await expect(service.revokeInvitation(SOCIETY, user({ id: 'res-b', flatId: FLAT_B }), made.id)).rejects.toThrow(NotFoundException);
  });

  it('says so when it was already cancelled', async () => {
    const { service } = build();
    const made: any = await service.createInvitation(SOCIETY, user(), invite());
    await service.revokeInvitation(SOCIETY, user(), made.id);
    await expect(service.revokeInvitation(SOCIETY, user(), made.id)).rejects.toThrow(ConflictException);
  });

  it("lists only the resident's own flat", async () => {
    const { service } = build();
    await service.createInvitation(SOCIETY, user(), invite());
    await service.createInvitation(SOCIETY, user({ id: 'res-b', flatId: FLAT_B }), invite({ visitorName: 'Neighbour guest' }));
    const mine: any[] = await service.myInvitations(SOCIETY, user());
    expect(mine.map((i) => i.visitorName)).toEqual(['Ravi Kumar']);
  });
});

describe('scanCode — the gate', () => {
  async function withInvitation(over: Row = {}, buildOpts = {}) {
    const ctx = build(buildOpts);
    const made: any = await ctx.service.createInvitation(SOCIETY, user(), invite(over));
    return { ...ctx, made };
  }

  it('admits a valid code: the visitor is checked in, the use is counted, and the guard is recorded', async () => {
    const { service, db, made } = await withInvitation();
    const out: any = await service.scanCode(SOCIETY, guard, { code: made.code, clientRequestId: 's1' });
    expect(out.duplicate).toBe(false);
    expect(out.entry).toMatchObject({ status: 'CHECKED_IN', flatId: FLAT_A, decisionMethod: 'INVITATION', checkedInById: 'guard-1', registeredById: 'guard-1' });
    expect(db.invitations[0].usedCount).toBe(1);
  });

  it('forgives case, spaces and the dash when the guard types the code', async () => {
    const { service, made } = await withInvitation();
    const typed = made.code.toLowerCase().replace('-', '  ');
    await expect(service.scanCode(SOCIETY, guard, { code: typed, clientRequestId: 's1' })).resolves.toBeDefined();
  });

  it('refuses a single-use code the second time (replay)', async () => {
    const { service, db, made } = await withInvitation();
    await service.scanCode(SOCIETY, guard, { code: made.code, clientRequestId: 's1' });
    await expect(service.scanCode(SOCIETY, guard, { code: made.code, clientRequestId: 's2' })).rejects.toThrow(/already been used/);
    expect(db.invitations[0].usedCount).toBe(1);
    expect(db.entries).toHaveLength(1);
  });

  it('allows exactly maxUses entries and no more', async () => {
    const { service, db, made } = await withInvitation({ maxUses: 3 });
    for (let i = 1; i <= 3; i++) await service.scanCode(SOCIETY, guard, { code: made.code, clientRequestId: `s${i}` });
    await expect(service.scanCode(SOCIETY, guard, { code: made.code, clientRequestId: 's4' })).rejects.toThrow(ConflictException);
    expect(db.invitations[0].usedCount).toBe(3);
  });

  it('treats a retried request as the same scan: no second entry, no second use', async () => {
    const { service, db, made } = await withInvitation({ maxUses: 5 });
    const first: any = await service.scanCode(SOCIETY, guard, { code: made.code, clientRequestId: 'same' });
    const again: any = await service.scanCode(SOCIETY, guard, { code: made.code, clientRequestId: 'same' });
    expect(again.duplicate).toBe(true);
    expect(again.entry.id).toBe(first.entry.id);
    expect(db.invitations[0].usedCount).toBe(1);
    expect(db.entries).toHaveLength(1);
  });

  it('does not let a code from another society through', async () => {
    const { service, db, made } = await withInvitation();
    await expect(service.scanCode(OTHER_SOCIETY, guard, { code: made.code, clientRequestId: 's1' })).rejects.toThrow(/not valid for this society/);
    expect(db.invitations[0].usedCount).toBe(0);
  });

  it('refuses an expired invitation, with the reason', async () => {
    const { service, db, made } = await withInvitation();
    db.invitations[0].validUntil = new Date(Date.now() - 1000);
    await expect(service.scanCode(SOCIETY, guard, { code: made.code, clientRequestId: 's1' })).rejects.toThrow(/expired/);
  });

  it('refuses an invitation that has not started yet', async () => {
    const { service, made } = await withInvitation({ validFrom: inHours(2), validUntil: inHours(6) });
    await expect(service.scanCode(SOCIETY, guard, { code: made.code, clientRequestId: 's1' })).rejects.toThrow(/not valid yet/);
  });

  it('refuses a code that does not exist, without touching the database for a malformed one', async () => {
    const { service, db } = build();
    await expect(service.scanCode(SOCIETY, guard, { code: 'AAAAAAAA', clientRequestId: 's1' })).rejects.toThrow(/not valid for this society/);
    await expect(service.scanCode(SOCIETY, guard, { code: 'nope', clientRequestId: 's2' })).rejects.toThrow(BadRequestException);
    expect(db.rawCalls).toHaveLength(1); // only the well-formed attempt reached the database
  });

  it('leaves no use spent and no entry behind when recording the entry fails', async () => {
    const { service, db, made, prisma } = await withInvitation({ maxUses: 2 });
    prisma.visitorEntry.create.mockRejectedValueOnce(new Error('disk full'));
    await expect(service.scanCode(SOCIETY, guard, { code: made.code, clientRequestId: 's1' })).rejects.toThrow('disk full');
    expect(db.invitations[0].usedCount).toBe(0);
    expect(db.entries).toHaveLength(0);
  });

  it('a racing duplicate of the same attempt returns the winner and spends nothing extra', async () => {
    const { service, db, made, prisma } = await withInvitation({ maxUses: 5 });
    const winner: any = await service.scanCode(SOCIETY, guard, { code: made.code, clientRequestId: 'race' });
    // Simulate the lookup missing the winner, so the second attempt reaches the insert and loses on the unique key.
    prisma.visitorEntry.findFirst.mockResolvedValueOnce(null);
    const loser: any = await service.scanCode(SOCIETY, guard, { code: made.code, clientRequestId: 'race' });
    expect(loser.duplicate).toBe(true);
    expect(loser.entry.id).toBe(winner.entry.id);
    expect(db.invitations[0].usedCount).toBe(1);
  });

  it('tells the inviting resident their guest arrived', async () => {
    const { service, db, made } = await withInvitation();
    await service.scanCode(SOCIETY, guard, { code: made.code, clientRequestId: 's1' });
    expect(db.sent).toEqual([expect.objectContaining({ userIds: ['res-a'], payload: expect.objectContaining({ type: 'VISITOR_ARRIVED' }) })]);
  });

  it('writes an audit record naming the guard and the method', async () => {
    const { service, db, made } = await withInvitation();
    await service.scanCode(SOCIETY, guard, { code: made.code, clientRequestId: 's1' });
    const a = db.audits.find((x) => x.newValues.action === 'VISITOR_CHECKED_IN')!;
    expect(a).toMatchObject({ actorId: 'guard-1', societyId: SOCIETY });
    expect(a.newValues).toMatchObject({ method: 'INVITATION', flatCode: 'A-403' });
  });

  // The SQL cannot be run against a fake, so its safety predicates are pinned by text.
  it('states every predicate that makes the claim safe, in the one statement', async () => {
    const { service, db, made } = await withInvitation();
    await service.scanCode(SOCIETY, guard, { code: made.code, clientRequestId: 's1' });
    const text = db.rawCalls[0].strings.join('?');
    for (const predicate of ['"codeHash" =', '"societyId" =', `"status" = 'ACTIVE'`, '"validFrom" <=', '"validUntil" >=', '"usedCount" < "maxUses"', '"usedCount" = "usedCount" + 1']) {
      expect(text).toContain(predicate);
    }
    expect(db.rawCalls[0].values).toEqual([hashCode(normalizeCode(made.code)!), SOCIETY, expect.any(Date), expect.any(Date)]);
  });
});

describe('registerWalkIn', () => {
  it('asks the residents of that flat — and only that flat', async () => {
    const { service, db } = build();
    const out: any = await service.registerWalkIn(SOCIETY, guard, walkIn());
    expect(out.entry).toMatchObject({ status: 'PENDING_APPROVAL', flatId: FLAT_A, registeredById: 'guard-1' });
    expect(out.notifiedResidents).toBe(2);
    expect(db.sent[0].userIds.sort()).toEqual(['res-a', 'res-a2']);
    expect(db.sent[0].payload).toMatchObject({ type: 'VISITOR_REQUEST' });
  });

  it('is safe to retry: the same clientRequestId returns the same entry and notifies nobody twice', async () => {
    const { service, db } = build();
    const dto = walkIn({ clientRequestId: 'retry-1' });
    const first: any = await service.registerWalkIn(SOCIETY, guard, dto);
    const second: any = await service.registerWalkIn(SOCIETY, guard, dto);
    expect(second.duplicate).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(db.entries).toHaveLength(1);
    expect(db.sent).toHaveLength(1);
  });

  it('survives two identical requests arriving at the same instant', async () => {
    const { service, db, prisma } = build();
    const dto = walkIn({ clientRequestId: 'both' });
    await service.registerWalkIn(SOCIETY, guard, dto);
    prisma.visitorEntry.findFirst.mockResolvedValueOnce(null); // the pre-check misses the first one
    const second: any = await service.registerWalkIn(SOCIETY, guard, dto);
    expect(second.duplicate).toBe(true);
    expect(db.entries).toHaveLength(1);
  });

  it('refuses a flat from another society', async () => {
    const { service, db } = build();
    await expect(service.registerWalkIn(SOCIETY, guard, walkIn({ flatId: 'flat-x' }))).rejects.toThrow(NotFoundException);
    expect(db.entries).toHaveLength(0);
  });

  it('lets a society that does not want approvals admit walk-ins straight away, still recording why', async () => {
    const { service, db } = build({ policy: { walkInApproval: 'NOT_REQUIRED' } });
    const out: any = await service.registerWalkIn(SOCIETY, guard, walkIn());
    expect(out.entry).toMatchObject({ status: 'APPROVED', decisionMethod: 'POLICY' });
    expect(db.sent[0].payload.type).toBe('VISITOR_ARRIVED');
  });

  it('upper-cases a vehicle number and keeps the type', async () => {
    const { service } = build();
    const out: any = await service.registerWalkIn(SOCIETY, guard, walkIn({ vehicleNumber: 'ts09 ab 1234', visitorType: 'CAB' }));
    expect(out.entry).toMatchObject({ vehicleNumber: 'TS09 AB 1234', visitorType: 'CAB' });
  });

  it('does not leak the client request id back out', async () => {
    const { service } = build();
    const out: any = await service.registerWalkIn(SOCIETY, guard, walkIn());
    expect(out.entry).not.toHaveProperty('clientRequestId');
  });

  it('records who registered the visitor', async () => {
    const { service, db } = build();
    await service.registerWalkIn(SOCIETY, guard, walkIn());
    expect(db.audits[0]).toMatchObject({ actorId: 'guard-1' });
    expect(db.audits[0].newValues).toMatchObject({ action: 'VISITOR_REGISTERED', flatCode: 'A-403', approval: 'REQUIRED' });
  });
});

describe('decide — the resident answers', () => {
  async function pending() {
    const ctx = build();
    const out: any = await ctx.service.registerWalkIn(SOCIETY, guard, walkIn());
    ctx.db.sent.length = 0;
    return { ...ctx, id: out.entry.id as string };
  }

  it('approves for their own flat, recording who, when and how', async () => {
    const { service, db, id } = await pending();
    const out: any = await service.decide(SOCIETY, user(), id, true, 'Expecting him');
    expect(out).toMatchObject({ status: 'APPROVED', decidedById: 'res-a', decisionMethod: 'RESIDENT', decisionNote: 'Expecting him' });
    expect(db.audits.at(-1)!.newValues).toMatchObject({ action: 'VISITOR_APPROVED', method: 'RESIDENT' });
  });

  it('declines for their own flat', async () => {
    const { service, id } = await pending();
    await expect(service.decide(SOCIETY, user(), id, false)).resolves.toMatchObject({ status: 'REJECTED' });
  });

  it("will not answer for another flat, and says only that it was not found", async () => {
    const { service, db, id } = await pending();
    await expect(service.decide(SOCIETY, user({ id: 'res-b', flatId: FLAT_B }), id, true)).rejects.toThrow(NotFoundException);
    expect(db.entries[0].status).toBe('PENDING_APPROVAL');
  });

  it('a second household member answering after the first gets "already answered"', async () => {
    const { service, id } = await pending();
    await service.decide(SOCIETY, user(), id, true);
    await expect(service.decide(SOCIETY, user({ id: 'res-a2' }), id, false)).rejects.toThrow(/already been answered/);
  });

  it('cannot be changed after the answer: approve then reject is refused', async () => {
    const { service, db, id } = await pending();
    await service.decide(SOCIETY, user(), id, true);
    await expect(service.decide(SOCIETY, user(), id, false)).rejects.toThrow(ConflictException);
    expect(db.entries[0].status).toBe('APPROVED');
  });

  it('refuses a late answer and marks the request expired', async () => {
    const { service, db, id } = await pending();
    db.entries[0].requestedAt = new Date(Date.now() - 31 * 60_000);
    await expect(service.decide(SOCIETY, user(), id, true)).rejects.toThrow(/expired/);
    expect(db.entries[0].status).toBe('EXPIRED');
  });

  it('is refused for someone with no flat', async () => {
    const { service, id } = await pending();
    await expect(service.decide(SOCIETY, guard, id, true)).rejects.toThrow(ForbiddenException);
  });

  it('tells the gate what the resident decided', async () => {
    const { service, db, id } = await pending();
    await service.decide(SOCIETY, user(), id, true);
    expect(db.sent.at(-1)).toMatchObject({ userIds: ['guard-1'], payload: { type: 'VISITOR_DECISION' } });
  });
});

describe('checkIn and checkOut', () => {
  async function approved() {
    const ctx = build();
    const reg: any = await ctx.service.registerWalkIn(SOCIETY, guard, walkIn());
    await ctx.service.decide(SOCIETY, user(), reg.entry.id, true);
    return { ...ctx, id: reg.entry.id as string };
  }

  it('lets an approved visitor in, recording the guard and the time', async () => {
    const { service, db, id } = await approved();
    const out: any = await service.checkIn(SOCIETY, guard, id);
    expect(out).toMatchObject({ status: 'CHECKED_IN', checkedInById: 'guard-1' });
    expect(out.checkedInAt).toBeInstanceOf(Date);
    expect(db.audits.at(-1)!.newValues.action).toBe('VISITOR_CHECKED_IN');
  });

  it('server-enforces approval: a visitor still waiting cannot be let in', async () => {
    const { service, db } = build();
    const reg: any = await service.registerWalkIn(SOCIETY, guard, walkIn());
    await expect(service.checkIn(SOCIETY, guard, reg.entry.id)).rejects.toThrow(/waiting for the resident/);
    expect(db.entries[0].status).toBe('PENDING_APPROVAL');
  });

  it('server-enforces a decline: a declined visitor cannot be let in', async () => {
    const { service, db } = build();
    const reg: any = await service.registerWalkIn(SOCIETY, guard, walkIn());
    await service.decide(SOCIETY, user(), reg.entry.id, false);
    await expect(service.checkIn(SOCIETY, guard, reg.entry.id)).rejects.toThrow(/declined/);
    expect(db.entries[0].status).toBe('REJECTED');
  });

  it('server-enforces expiry: a request nobody answered cannot be let in', async () => {
    const { service, db } = build();
    const reg: any = await service.registerWalkIn(SOCIETY, guard, walkIn());
    db.entries[0].status = 'EXPIRED';
    await expect(service.checkIn(SOCIETY, guard, reg.entry.id)).rejects.toThrow(/expired/);
  });

  it('pressing "let in" twice is harmless and logs it once', async () => {
    const { service, db, id } = await approved();
    await service.checkIn(SOCIETY, guard, id);
    const auditsAfterFirst = db.audits.length;
    await expect(service.checkIn(SOCIETY, guard, id)).resolves.toMatchObject({ status: 'CHECKED_IN' });
    expect(db.audits).toHaveLength(auditsAfterFirst);
  });

  it('records the exit, and a repeated exit is harmless', async () => {
    const { service, id } = await approved();
    await service.checkIn(SOCIETY, guard, id);
    const out: any = await service.checkOut(SOCIETY, guard, id);
    expect(out).toMatchObject({ status: 'CHECKED_OUT', checkedOutById: 'guard-1' });
    await expect(service.checkOut(SOCIETY, guard, id)).resolves.toMatchObject({ status: 'CHECKED_OUT' });
  });

  it('cannot check out someone who never entered', async () => {
    const { service, id } = await approved();
    await expect(service.checkOut(SOCIETY, guard, id)).rejects.toThrow(/not been let in/);
  });

  it("cannot touch another society's visitor", async () => {
    const { service, id } = await approved();
    await expect(service.checkIn(OTHER_SOCIETY, guard, id)).rejects.toThrow(NotFoundException);
    await expect(service.checkOut(OTHER_SOCIETY, guard, id)).rejects.toThrow(NotFoundException);
  });
});

describe('what each person can see', () => {
  it("shows a resident only their own flat's visitors", async () => {
    const { service } = build();
    await service.registerWalkIn(SOCIETY, guard, walkIn({ flatId: FLAT_A, visitorName: 'For A' }));
    await service.registerWalkIn(SOCIETY, guard, walkIn({ flatId: FLAT_B, visitorName: 'For B' }));
    const mine: any[] = await service.myVisitors(SOCIETY, user());
    expect(mine.map((v) => v.visitorName)).toEqual(['For A']);
  });

  it('gives the guard a destination list without resident names', async () => {
    const { service } = build();
    const flats = await service.lookupFlats(SOCIETY, 'a-4');
    expect(flats).toEqual([{ id: FLAT_A, flatCode: 'A-403', buildingName: 'Block A' }]);
    expect(JSON.stringify(flats)).not.toMatch(/Asha|res-a/);
  });

  it("never lists another society's flats to a guard", async () => {
    const { service } = build();
    const flats = await service.lookupFlats(SOCIETY);
    expect(flats.map((f) => f.flatCode)).not.toContain('X-1');
  });

  it('shows the guard what is open plus today, not last month', async () => {
    const { service, db } = build();
    const old: any = await service.registerWalkIn(SOCIETY, guard, walkIn({ visitorName: 'Long gone' }));
    Object.assign(db.entries.find((e) => e.id === old.entry.id)!, { status: 'CHECKED_OUT', requestedAt: new Date(Date.now() - 40 * 86_400_000) });
    await service.registerWalkIn(SOCIETY, guard, walkIn({ visitorName: 'Today' }));
    const list: any[] = await service.gateList(SOCIETY);
    expect(list.map((v) => v.visitorName)).toEqual(['Today']);
  });

  it('keeps a visitor still inside on the list even from yesterday', async () => {
    const { service, db } = build();
    const r: any = await service.registerWalkIn(SOCIETY, guard, walkIn({ visitorName: 'Stayed over' }));
    Object.assign(db.entries.find((e) => e.id === r.entry.id)!, { status: 'CHECKED_IN', requestedAt: new Date(Date.now() - 30 * 3_600_000) });
    const list: any[] = await service.gateList(SOCIETY);
    expect(list.map((v) => v.visitorName)).toContain('Stayed over');
  });

  it('lets the guard search by name, phone, vehicle or flat', async () => {
    const { service } = build();
    await service.registerWalkIn(SOCIETY, guard, walkIn({ visitorName: 'Meena', visitorPhone: '+919812345678', vehicleNumber: 'KA01AB1234' }));
    await service.registerWalkIn(SOCIETY, guard, walkIn({ flatId: FLAT_B, visitorName: 'Suresh' }));
    for (const term of ['mee', '98123', 'ka01', 'b-101']) {
      expect((await service.gateList(SOCIETY, term)).length).toBe(1);
    }
  });

  it('expires stale requests whenever it lists', async () => {
    const { service, db } = build();
    await service.registerWalkIn(SOCIETY, guard, walkIn());
    db.entries[0].requestedAt = new Date(Date.now() - 45 * 60_000);
    const list: any[] = await service.gateList(SOCIETY);
    expect(list[0].status).toBe('EXPIRED');
  });
});

describe('adminLog', () => {
  it('pages, filters and names the people who acted', async () => {
    const { service } = build();
    for (let i = 0; i < 3; i++) await service.registerWalkIn(SOCIETY, guard, walkIn({ visitorName: `V${i}`, visitorType: i === 0 ? 'CAB' : 'GUEST' }));
    const all: any = await service.adminLog(SOCIETY, { limit: 2 });
    expect(all.data).toHaveLength(2);
    expect(all.meta.total).toBe(3);
    expect(all.data[0].registeredBy).toContain('Gopal');
    const cabs: any = await service.adminLog(SOCIETY, { visitorType: 'CAB' as any });
    expect(cabs.data.map((v: any) => v.visitorName)).toEqual(['V0']);
  });

  it("never includes another society's entries", async () => {
    const { service, db } = build();
    await service.registerWalkIn(SOCIETY, guard, walkIn());
    db.entries.push({ id: 'foreign', societyId: OTHER_SOCIETY, flatId: 'flat-x', visitorName: 'Foreign', status: 'CHECKED_OUT', requestedAt: new Date(), createdAt: new Date() });
    const log: any = await service.adminLog(SOCIETY, {});
    expect(log.data.map((v: any) => v.visitorName)).not.toContain('Foreign');
  });
});

describe('override — the committee', () => {
  async function unanswered() {
    const ctx = build();
    const reg: any = await ctx.service.registerWalkIn(SOCIETY, guard, walkIn());
    ctx.db.sent.length = 0;
    return { ...ctx, id: reg.entry.id as string };
  }

  it('decides an unanswered request, with the reason recorded and the residents told', async () => {
    const { service, db, id } = await unanswered();
    const out: any = await service.override(SOCIETY, admin, id, { action: 'APPROVE', reason: 'Plumber the committee arranged' });
    expect(out).toMatchObject({ status: 'APPROVED', decisionMethod: 'ADMIN_OVERRIDE', decidedById: 'admin-1', decisionNote: 'Plumber the committee arranged' });
    const audit = db.audits.at(-1)!;
    expect(audit.newValues).toMatchObject({ action: 'VISITOR_OVERRIDE', decision: 'APPROVE', reason: 'Plumber the committee arranged' });
    expect(db.sent.find((s) => s.payload.type === 'VISITOR_OVERRIDE')!.userIds.sort()).toEqual(['res-a', 'res-a2']);
  });

  it('can also decide an expired request', async () => {
    const { service, db, id } = await unanswered();
    db.entries[0].status = 'EXPIRED';
    await expect(service.override(SOCIETY, admin, id, { action: 'REJECT', reason: 'Not expected' })).resolves.toMatchObject({ status: 'REJECTED' });
  });

  it('cannot reverse a decision the resident already made', async () => {
    const { service, db, id } = await unanswered();
    await service.decide(SOCIETY, user(), id, false);
    await expect(service.override(SOCIETY, admin, id, { action: 'APPROVE', reason: 'Changed my mind' })).rejects.toThrow(/already been decided/);
    expect(db.entries[0].status).toBe('REJECTED');
  });

  it("cannot reach another society's entry", async () => {
    const { service, id } = await unanswered();
    await expect(service.override(OTHER_SOCIETY, admin, id, { action: 'APPROVE', reason: 'x y z' })).rejects.toThrow(NotFoundException);
  });
});

describe('policy', () => {
  it('defaults safely and merges an update without losing other settings', async () => {
    const { service, db } = build();
    db.config.additionalConfig = { upiId: 'gv@bank' };
    expect(await service.getPolicy(SOCIETY)).toMatchObject({ walkInApproval: 'REQUIRED', maxInviteDays: 7 });
    const next = await service.updatePolicy(SOCIETY, { maxInviteDays: 3 }, 'admin-1');
    expect(next).toMatchObject({ walkInApproval: 'REQUIRED', maxInviteDays: 3, maxUsesPerInvite: 10 });
    expect(db.config.additionalConfig).toMatchObject({ upiId: 'gv@bank', visitorPolicy: { maxInviteDays: 3 } });
  });

  it('records who changed the rules, and what they were before', async () => {
    const { service, db } = build();
    await service.updatePolicy(SOCIETY, { walkInApproval: 'NOT_REQUIRED' }, 'admin-1');
    expect(db.audits[0]).toMatchObject({ actorId: 'admin-1' });
    expect(db.audits[0].oldValues).toMatchObject({ walkInApproval: 'REQUIRED' });
    expect(db.audits[0].newValues).toMatchObject({ action: 'VISITOR_POLICY_UPDATED', walkInApproval: 'NOT_REQUIRED' });
  });
});
