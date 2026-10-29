/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, SystemRole } from '@prisma/client';
import { DeliveriesService } from './deliveries.service';
import { expectationState } from './delivery-rules';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

const SOCIETY = 'soc-1';
const OTHER_SOCIETY = 'soc-2';
const FLAT_A = 'flat-a';
const FLAT_B = 'flat-b';

const user = (over: Partial<AuthenticatedUser> = {}): AuthenticatedUser =>
  ({ id: 'res-a', email: 'a@x.com', firstName: 'Asha', lastName: 'Rao', isPlatformAdmin: false, societyId: SOCIETY, flatId: FLAT_A, currentRole: SystemRole.RESIDENT, ...over }) as AuthenticatedUser;
const guard = user({ id: 'guard-1', flatId: undefined, currentRole: SystemRole.SECURITY_GUARD });
const resB = user({ id: 'res-b', flatId: FLAT_B });

type Row = Record<string, any>;

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
      if ('lt' in c && !(v < c.lt)) return false;
      if ('contains' in c && !String(v ?? '').toLowerCase().includes(String(c.contains).toLowerCase())) return false;
      return true;
    }
    return v === cond;
  });
}

function build() {
  let seq = 0;
  const db = {
    expectations: [] as Row[],
    parcels: [] as Row[],
    flats: [
      { id: FLAT_A, societyId: SOCIETY, flatCode: 'A-403', isActive: true, deletedAt: null },
      { id: FLAT_B, societyId: SOCIETY, flatCode: 'B-101', isActive: true, deletedAt: null },
      { id: 'flat-x', societyId: OTHER_SOCIETY, flatCode: 'X-1', isActive: true, deletedAt: null },
    ] as Row[],
    memberships: [
      { userId: 'res-a', societyId: SOCIETY, flatId: FLAT_A, role: 'RESIDENT', status: 'ACTIVE' },
      { userId: 'res-a2', societyId: SOCIETY, flatId: FLAT_A, role: 'RESIDENT', status: 'ACTIVE' },
      { userId: 'res-b', societyId: SOCIETY, flatId: FLAT_B, role: 'RESIDENT', status: 'ACTIVE' },
      { userId: 'guard-1', societyId: SOCIETY, flatId: FLAT_A, role: 'SECURITY_GUARD', status: 'ACTIVE' },
    ] as Row[],
    audits: [] as Row[],
    sent: [] as { userIds: string[]; payload: Row }[],
  };
  const view = (r: Row, include?: Row) => (include?.flat ? { ...r, flat: { flatCode: db.flats.find((f) => f.id === r.flatId)?.flatCode } } : { ...r });
  const p2002 = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' });

  const model = (rows: Row[], defaults: () => Row, order: string) => ({
    create: jest.fn(async ({ data }: Row) => {
      if (data.clientRequestId && rows.some((r) => r.societyId === data.societyId && r.clientRequestId === data.clientRequestId)) throw p2002();
      const row = { id: `row-${++seq}`, createdAt: new Date(), updatedAt: new Date(), ...defaults(), ...data };
      rows.push(row);
      return { ...row };
    }),
    findMany: jest.fn(async ({ where, include, take }: Row = {}) =>
      rows.filter((r) => matches(r, where, db.flats)).sort((a, b) => b[order] - a[order]).slice(0, take ?? 1e9).map((r) => view(r, include)),
    ),
    findFirst: jest.fn(async ({ where, include }: Row = {}) => {
      const r = rows.find((x) => matches(x, where, db.flats));
      return r ? view(r, include) : null;
    }),
    findUniqueOrThrow: jest.fn(async ({ where }: Row) => {
      const r = rows.find((x) => matches(x, where, db.flats));
      if (!r) throw new Error('not found');
      return { ...r };
    }),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const hit = rows.filter((r) => matches(r, where, db.flats));
      hit.forEach((r) => Object.assign(r, data, { updatedAt: new Date() }));
      return { count: hit.length };
    }),
    count: jest.fn(async ({ where }: Row = {}) => rows.filter((r) => matches(r, where, db.flats)).length),
  });

  const prisma: any = {
    deliveryExpectation: model(db.expectations, () => ({ usedCount: 0, status: 'ACTIVE', cancelledAt: null, note: null, maxUses: 1 }), 'createdAt'),
    parcel: model(db.parcels, () => ({ status: 'RECEIVED', receivedAt: new Date(), closedAt: null, closedById: null, collectedByName: null, recipientName: null, note: null, clientRequestId: null }), 'receivedAt'),
    flat: { findFirst: jest.fn(async ({ where }: Row) => db.flats.find((f) => matches(f, where, db.flats)) ?? null) },
    societyMembership: { findMany: jest.fn(async ({ where }: Row) => db.memberships.filter((m) => matches(m, where, db.flats))) },
    user: { findMany: jest.fn(async ({ where }: Row) => (where.id.in as string[]).map((id) => ({ id, firstName: 'P', lastName: id }))) },
    auditLog: { create: jest.fn(async ({ data }: Row) => void db.audits.push(data)) },
  };
  const notifications = {
    sendToUsers: jest.fn(async (_s: string, userIds: string[], payload: Row) => void db.sent.push({ userIds, payload })),
    notifyQuietly: jest.fn(async (fn: () => Promise<unknown>) => fn()),
  } as unknown as NotificationsService;
  return { service: new DeliveriesService(prisma as PrismaService, notifications), db };
}

const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();
const expect1 = (over: Row = {}) => ({ company: 'Amazon', instruction: 'ALLOW_ENTRY' as const, ...over }) as any;
const parcel = (over: Row = {}) => ({ flatId: FLAT_A, courier: 'Amazon', clientRequestId: `req-${Math.random()}`, ...over }) as any;

describe('expectationState', () => {
  const base = { status: 'ACTIVE', instruction: 'ALLOW_ENTRY', validFrom: new Date('2026-10-30T10:00Z'), validUntil: new Date('2026-10-30T12:00Z'), usedCount: 0, maxUses: 1 } as any;
  const at = (s: string) => new Date(`2026-10-30T${s}Z`);
  it.each([
    ['inside the window', {}, '11:00', 'ACTIVE'],
    ['before it starts', {}, '09:00', 'NOT_YET'],
    ['after it ends', {}, '12:01', 'EXPIRED'],
    ['an entry instruction that has been spent', { usedCount: 1 }, '11:00', 'USED'],
    ['a leave-at-gate instruction is never "spent"', { instruction: 'LEAVE_AT_GATE', usedCount: 5 }, '11:00', 'ACTIVE'],
    ['cancelled, even inside the window', { status: 'CANCELLED' }, '11:00', 'CANCELLED'],
  ])('%s', (_n, over, time, expected) => expect(expectationState({ ...base, ...over }, at(time))).toBe(expected));
});

describe('resident delivery instructions', () => {
  it('uses the resident’s own flat, never one from the request', async () => {
    const { service, db } = build();
    await service.createExpectation(SOCIETY, user(), { ...expect1(), flatId: FLAT_B });
    expect(db.expectations[0].flatId).toBe(FLAT_A);
    expect(db.audits[0].newValues.action).toBe('DELIVERY_EXPECTED');
  });

  it('defaults to 12 hours and refuses a time in the past or too far ahead', async () => {
    const { service, db } = build();
    await service.createExpectation(SOCIETY, user(), expect1());
    const hours = (db.expectations[0].validUntil.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(11.9);
    expect(hours).toBeLessThanOrEqual(12);
    await expect(service.createExpectation(SOCIETY, user(), expect1({ validUntil: inHours(-1) }))).rejects.toThrow(BadRequestException);
    await expect(service.createExpectation(SOCIETY, user(), expect1({ validUntil: inHours(100) }))).rejects.toThrow(/72 hours/);
  });

  it('only lets entry instructions carry more than one use', async () => {
    const { service, db } = build();
    await service.createExpectation(SOCIETY, user(), expect1({ maxUses: 4 }));
    await service.createExpectation(SOCIETY, user(), expect1({ instruction: 'LEAVE_AT_GATE', maxUses: 4 }));
    expect(db.expectations.map((e) => e.maxUses)).toEqual([4, 1]);
  });

  it('refuses gate staff and people without a flat', async () => {
    const { service } = build();
    await expect(service.createExpectation(SOCIETY, user({ currentRole: SystemRole.SECURITY_GUARD }), expect1())).rejects.toThrow(/Gate staff/);
    await expect(service.myParcels(SOCIETY, user({ flatId: undefined }))).rejects.toThrow(ForbiddenException);
  });

  it('cancels once; another flat sees "not found", a repeat sees "already cancelled"', async () => {
    const { service } = build();
    const made: any = await service.createExpectation(SOCIETY, user(), expect1());
    await expect(service.cancelExpectation(SOCIETY, resB, made.id)).rejects.toThrow(NotFoundException);
    await expect(service.cancelExpectation(SOCIETY, user({ id: 'res-a2' }), made.id)).resolves.toMatchObject({ state: 'CANCELLED' });
    await expect(service.cancelExpectation(SOCIETY, user(), made.id)).rejects.toThrow(ConflictException);
  });

  it('shows the gate only instructions that are still live', async () => {
    const { service, db } = build();
    const live: any = await service.createExpectation(SOCIETY, user(), expect1({ company: 'Swiggy' }));
    const cancelled: any = await service.createExpectation(SOCIETY, user(), expect1({ company: 'Zepto' }));
    await service.cancelExpectation(SOCIETY, user(), cancelled.id);
    const spent: any = await service.createExpectation(SOCIETY, user(), expect1({ company: 'Blinkit' }));
    db.expectations.find((e) => e.id === spent.id)!.usedCount = 1;
    db.expectations.find((e) => e.id === live.id)!.flatId = FLAT_A;
    const shown = await service.gateExpected(SOCIETY);
    expect(shown.map((s) => s.company)).toEqual(['Swiggy']);
    expect(shown[0].flatCode).toBe('A-403');
  });
});

describe('parcels at the gate', () => {
  it('records a parcel and tells the household, not the gate staff', async () => {
    const { service, db } = build();
    const res: any = await service.receiveParcel(SOCIETY, guard, parcel({ recipientName: 'Asha' }));
    expect(res.duplicate).toBe(false);
    expect(res.parcel.flatCode).toBe('A-403');
    expect(res.parcel).not.toHaveProperty('clientRequestId');
    expect(res.notifiedResidents).toBe(2);
    expect(db.sent[0].userIds.sort()).toEqual(['res-a', 'res-a2']);
    expect(db.sent[0].payload.type).toBe('PARCEL_RECEIVED');
    expect(db.audits[0].newValues.action).toBe('PARCEL_RECEIVED');
  });

  it('a retried submission returns the same parcel and notifies nobody again', async () => {
    const { service, db } = build();
    const body = parcel({ clientRequestId: 'same-attempt' });
    const first: any = await service.receiveParcel(SOCIETY, guard, body);
    const again: any = await service.receiveParcel(SOCIETY, guard, body);
    expect(again.duplicate).toBe(true);
    expect(again.parcel.id).toBe(first.parcel.id);
    expect(db.parcels).toHaveLength(1);
    expect(db.sent).toHaveLength(1);
  });

  it('refuses a flat from another society', async () => {
    const { service } = build();
    await expect(service.receiveParcel(SOCIETY, guard, parcel({ flatId: 'flat-x' }))).rejects.toThrow(NotFoundException);
  });

  it('hands over once; pressing again just shows it, and it cannot then be returned', async () => {
    const { service, db } = build();
    const made: any = await service.receiveParcel(SOCIETY, guard, parcel());
    const id = made.parcel.id;
    const done: any = await service.handOver(SOCIETY, guard, id, { collectedByName: 'Asha' });
    expect(done.status).toBe('COLLECTED');
    expect(db.parcels[0].collectedByName).toBe('Asha');
    await expect(service.handOver(SOCIETY, guard, id, {})).resolves.toMatchObject({ status: 'COLLECTED' });
    await expect(service.returnToCourier(SOCIETY, guard, id)).rejects.toThrow(/already handed over/);
    expect(db.audits.filter((a) => a.newValues.action === 'PARCEL_HANDED_OVER')).toHaveLength(1);
  });

  it('sends a parcel back, and a parcel from another society is "not found"', async () => {
    const { service, db } = build();
    const made: any = await service.receiveParcel(SOCIETY, guard, parcel());
    await expect(service.returnToCourier(OTHER_SOCIETY, guard, made.parcel.id)).rejects.toThrow(NotFoundException);
    await expect(service.returnToCourier(SOCIETY, guard, made.parcel.id)).resolves.toMatchObject({ status: 'RETURNED' });
    expect(db.parcels[0].collectedByName).toBeNull();
  });

  it('a household sees its own parcels only', async () => {
    const { service } = build();
    await service.receiveParcel(SOCIETY, guard, parcel({ flatId: FLAT_A }));
    await service.receiveParcel(SOCIETY, guard, parcel({ flatId: FLAT_B, courier: 'Flipkart' }));
    expect((await service.myParcels(SOCIETY, user())).map((p) => p.courier)).toEqual(['Amazon']);
    expect((await service.myParcels(SOCIETY, resB)).map((p) => p.courier)).toEqual(['Flipkart']);
  });

  it('the gate list searches by courier, name or flat', async () => {
    const { service } = build();
    await service.receiveParcel(SOCIETY, guard, parcel());
    await service.receiveParcel(SOCIETY, guard, parcel({ flatId: FLAT_B, courier: 'Flipkart' }));
    expect(await service.gateParcels(SOCIETY, 'flip')).toHaveLength(1);
    expect(await service.gateParcels(SOCIETY, 'a-403')).toHaveLength(1);
    expect(await service.gateParcels(SOCIETY)).toHaveLength(2);
  });
});
