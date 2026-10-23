/**
 * AmenitiesService against a small stateful fake of the database.
 *
 * The fake matters for the two things a plain mock cannot prove:
 *  - the double-booking race: $queryRaw ... FOR UPDATE really serialises
 *    transactions on the amenity row, and count() yields to the event loop,
 *    so removing the lock from the service makes the concurrency tests fail
 *    (verified by deleting the lock line and watching them fail);
 *  - atomicity: a transaction that throws is rolled back, so "the fee claim
 *    must not stick if the account turns out to be someone else's" is a real
 *    assertion, not a hope.
 * It proves the application logic given the single-statement guarantees
 * Postgres provides; it is not a substitute for a load test on a live database.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AmenitiesService } from './amenities.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';

const SOCIETY = 'society-a';
const OTHER_SOCIETY = 'society-b';
const AMENITY = 'amenity-1';
const FLAT = 'flat-10';
const OTHER_FLAT = 'flat-20';
const ADMIN = 'admin-1';
const ACCOUNT = 'account-1';

// "Now" is 11:30 IST on Sunday 1 Nov 2026. Everything below is relative to it.
const NOW = new Date('2026-11-01T06:00:00Z');
// 2026-11-04 18:00–19:00 IST, comfortably in the future and inside any default horizon.
const SLOT_18 = new Date('2026-11-04T12:30:00Z');
const SLOT_19 = new Date('2026-11-04T13:30:00Z');

const resident = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'user-1',
  email: 'r@example.test',
  firstName: 'Asha',
  lastName: 'Rao',
  isPlatformAdmin: false,
  societyId: SOCIETY,
  flatId: FLAT,
  currentRole: 'RESIDENT' as any,
  ...overrides,
});

type Row = Record<string, any>;

/** Equality, {in}, {lt}, {gt}, {gte}, {lte} — the only operators the service uses. */
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, cond]) => {
    const value = row[key];
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && !Prisma.Decimal.isDecimal(cond)) {
      const v = value instanceof Date ? value.getTime() : value;
      const n = (x: any) => (x instanceof Date ? x.getTime() : x);
      if ('in' in cond && !cond.in.includes(value)) return false;
      if ('lt' in cond && !(v < n(cond.lt))) return false;
      if ('gt' in cond && !(v > n(cond.gt))) return false;
      if ('gte' in cond && !(v >= n(cond.gte))) return false;
      if ('lte' in cond && !(v <= n(cond.lte))) return false;
      return true;
    }
    return value instanceof Date && cond instanceof Date ? value.getTime() === cond.getTime() : value === cond;
  });
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function makeWorld(amenityOverrides: Row = {}) {
  const amenities: Row[] = [
    {
      id: AMENITY,
      societyId: SOCIETY,
      name: 'Clubhouse',
      description: null,
      rules: null,
      bookingMode: 'INSTANT',
      slotMinutes: 60,
      opensAtMin: 360,
      closesAtMin: 1320,
      maxAdvanceDays: 30,
      monthlyCapPerFlat: null,
      cancelBeforeHours: 24,
      capacity: 1,
      maxSlotsPerBooking: 1,
      fee: null,
      isActive: true,
      ...amenityOverrides,
    },
  ];
  let bookings: Row[] = [];
  const accounts: Row[] = [
    { id: ACCOUNT, societyId: SOCIETY, isActive: true, currentBalance: new Prisma.Decimal(1000) },
    { id: 'account-other', societyId: OTHER_SOCIETY, isActive: true, currentBalance: new Prisma.Decimal(0) },
  ];
  let transactions: Row[] = [];
  const audits: Row[] = [];
  const committee = [{ userId: ADMIN }, { userId: 'committee-2' }];
  let nextId = 1;
  const locks = new Map<string, Promise<void>>();

  const withAmenity = (b: Row | undefined, include?: Row) =>
    b && include?.amenity ? { ...b, amenity: amenities.find((a) => a.id === b.amenityId) } : b ? { ...b } : null;

  const models = {
    amenity: {
      findFirst: jest.fn(async ({ where }: any) => amenities.find((a) => matches(a, where)) ?? null),
      findMany: jest.fn(async ({ where }: any) => amenities.filter((a) => matches(a, where))),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `amenity-${amenities.length + 1}`, isActive: true, ...data };
        amenities.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = amenities.find((a) => a.id === where.id)!;
        Object.assign(row, data);
        return { ...row };
      }),
    },
    amenityBooking: {
      findMany: jest.fn(async ({ where, skip = 0, take }: any) => {
        const rows = bookings
          .filter((b) => matches(b, where))
          .sort((a, b) => b.startAt.getTime() - a.startAt.getTime())
          .map((b) => ({
            ...b,
            amenity: { id: b.amenityId, name: 'Clubhouse' },
            flat: { id: b.flatId, flatCode: 'A-101' },
            user: { id: b.userId, firstName: 'Asha', lastName: 'Rao' },
          }));
        return take ? rows.slice(skip, skip + take) : rows;
      }),
      count: jest.fn(async ({ where }: any) => {
        // Read first, then yield: the answer reflects the moment of the read, and
        // other requests run before the caller acts on it — the real read-then-write
        // gap. Yielding before the read would let each request see the last one's insert.
        const found = bookings.filter((b) => matches(b, where)).length;
        await tick();
        return found;
      }),
      create: jest.fn(async ({ data, include }: any) => {
        const row = {
          id: `booking-${nextId++}`,
          decidedById: null,
          decidedAt: null,
          rejectionReason: null,
          cancelledAt: null,
          cancelledById: null,
          collectedAccountId: null,
          ...data,
        };
        bookings.push(row);
        return withAmenity(row, include);
      }),
      findFirst: jest.fn(async ({ where, include }: any) =>
        withAmenity(bookings.find((b) => matches(b, where)), include),
      ),
      findUnique: jest.fn(async ({ where, include }: any) =>
        withAmenity(bookings.find((b) => b.id === where.id), include),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const hit = bookings.filter((b) => matches(b, where));
        hit.forEach((b) => Object.assign(b, data));
        return { count: hit.length };
      }),
    },
    account: {
      findFirst: jest.fn(async ({ where }: any) => accounts.find((a) => matches(a, where)) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const row = accounts.find((a) => a.id === where.id)!;
        if (data.currentBalance?.increment) row.currentBalance = row.currentBalance.plus(data.currentBalance.increment);
        return { ...row };
      }),
    },
    transaction: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `txn-${transactions.length + 1}`, ...data };
        transactions.push(row);
        return row;
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        audits.push(data);
        return data;
      }),
    },
    societyMembership: { findMany: jest.fn(async () => committee) },
  };

  const prisma = {
    ...models,
    $queryRaw: jest.fn(),
    $transaction: jest.fn(async (cb: (tx: any) => Promise<unknown>) => {
      // Postgres undoes only the failing transaction's OWN writes, never a
      // neighbour's — so each write made through tx records how to reverse it.
      const undo: Array<() => void> = [];
      let release!: () => void;
      const done = new Promise<void>((resolve) => (release = resolve));
      const held: string[] = [];
      const tx = {
        ...models,
        amenityBooking: {
          ...models.amenityBooking,
          create: async (args: any) => {
            const row = (await models.amenityBooking.create(args)) as Row;
            undo.push(() => {
              bookings = bookings.filter((b) => b.id !== row.id);
            });
            return row;
          },
          updateMany: async (args: any) => {
            const before = bookings.filter((b) => matches(b, args.where)).map((b) => ({ b, copy: { ...b } }));
            const result = await models.amenityBooking.updateMany(args);
            undo.push(() => before.forEach(({ b, copy }) => Object.assign(b, copy)));
            return result;
          },
        },
        account: {
          ...models.account,
          update: async (args: any) => {
            const row = accounts.find((a) => a.id === args.where.id)!;
            const before = { ...row };
            const result = await models.account.update(args);
            undo.push(() => Object.assign(row, before));
            return result;
          },
        },
        transaction: {
          ...models.transaction,
          create: async (args: any) => {
            const row = await models.transaction.create(args);
            undo.push(() => {
              transactions = transactions.filter((t) => t !== row);
            });
            return row;
          },
        },
        // $queryRaw`SELECT id FROM amenities WHERE id = ${id} FOR UPDATE` — the first interpolation is the id.
        $queryRaw: async (_strings: TemplateStringsArray, id: string) => {
          while (locks.has(id)) await locks.get(id);
          locks.set(id, done);
          held.push(id);
          return [];
        },
      };
      try {
        return await cb(tx);
      } catch (err) {
        undo.reverse().forEach((fn) => fn());
        throw err;
      } finally {
        for (const id of held) if (locks.get(id) === done) locks.delete(id);
        release();
      }
    }),
  } as unknown as PrismaService;

  const notifications = {
    notifyQuietly: jest.fn(async (fn: () => Promise<unknown>) => {
      await fn();
    }),
    sendToUsers: jest.fn().mockResolvedValue(null),
  } as unknown as NotificationsService;

  return {
    service: new AmenitiesService(prisma, notifications),
    prisma,
    notifications,
    amenities,
    audits,
    get bookings() {
      return bookings;
    },
    get accounts() {
      return accounts;
    },
    get transactions() {
      return transactions;
    },
  };
}

beforeEach(() => {
  jest.useFakeTimers({
    now: NOW,
    // Only Date is faked: the fake DB's setImmediate must keep running.
    doNotFake: [
      'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'requestAnimationFrame',
      'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback', 'setImmediate',
      'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout',
    ],
  });
});
afterEach(() => jest.useRealTimers());

const book = (w: ReturnType<typeof makeWorld>, startAt = SLOT_18, user = resident(), extra: Row = {}) =>
  w.service.book(SOCIETY, user, { amenityId: AMENITY, startAt: startAt.toISOString(), ...extra } as any);

describe('createAmenity / updateAmenity', () => {
  it('applies sensible defaults, trims the name, and audits', async () => {
    const w = makeWorld();
    const created = await w.service.createAmenity(SOCIETY, { name: '  Tennis Court  ' }, ADMIN);

    expect(created).toMatchObject({
      name: 'Tennis Court',
      bookingMode: 'INSTANT',
      slotMinutes: 60,
      opensAtMin: 360,
      closesAtMin: 1320,
      capacity: 1,
      cancelBeforeHours: 24,
      fee: null,
    });
    expect(w.audits.at(-1)).toMatchObject({ actorId: ADMIN, entityType: 'Amenity', newValues: { action: 'AMENITY_CREATED' } });
  });

  it('stores a fee as a Decimal, and treats 0 as free', async () => {
    const w = makeWorld();
    const paid = await w.service.createAmenity(SOCIETY, { name: 'Hall', fee: 1500.5 }, ADMIN);
    const free = await w.service.createAmenity(SOCIETY, { name: 'Gym', fee: 0 }, ADMIN);

    expect(Prisma.Decimal.isDecimal(paid.fee)).toBe(true);
    expect(paid.fee?.toString()).toBe('1500.5');
    expect(free.fee).toBeNull();
  });

  it.each([
    [{ opensAtMin: 600, closesAtMin: 600 }, /after opening/],
    [{ opensAtMin: 600, closesAtMin: 500 }, /after opening/],
    [{ opensAtMin: 360, closesAtMin: 400, slotMinutes: 60 }, /longer than the time/],
    [{ opensAtMin: 360, closesAtMin: 480, slotMinutes: 60, maxSlotsPerBooking: 3 }, /longest allowed booking/],
  ])('refuses impossible hours %j', async (dto, message) => {
    const w = makeWorld();
    await expect(w.service.createAmenity(SOCIETY, { name: 'X', ...dto }, ADMIN)).rejects.toThrow(message);
    expect(w.amenities).toHaveLength(1); // only the seeded one
  });

  it('validates an edit against the values it is NOT changing', async () => {
    const w = makeWorld();
    // Existing closes at 22:00 (1320); moving only the opening time past that must fail.
    await expect(w.service.updateAmenity(SOCIETY, AMENITY, { opensAtMin: 1400 }, ADMIN)).rejects.toThrow(BadRequestException);
  });

  it('edits only the fields sent, and leaves existing bookings untouched', async () => {
    const w = makeWorld();
    await book(w);
    await w.service.updateAmenity(SOCIETY, AMENITY, { name: 'Club House', fee: 200 }, ADMIN);

    expect(w.amenities[0]).toMatchObject({ name: 'Club House', slotMinutes: 60, capacity: 1 });
    expect(w.bookings).toHaveLength(1);
    expect(w.bookings[0].status).toBe('CONFIRMED');
  });

  it("will not edit another society's amenity", async () => {
    const w = makeWorld();
    await expect(w.service.updateAmenity(OTHER_SOCIETY, AMENITY, { name: 'x' }, ADMIN)).rejects.toThrow(NotFoundException);
  });

  it('can deactivate, and inactive amenities drop out of the resident list', async () => {
    const w = makeWorld();
    await w.service.updateAmenity(SOCIETY, AMENITY, { isActive: false }, ADMIN);

    expect(await w.service.listAmenities(SOCIETY, false)).toHaveLength(0);
    expect(await w.service.listAmenities(SOCIETY, true)).toHaveLength(1);
  });
});

describe('getAvailability', () => {
  it('marks past slots, free slots, and full slots', async () => {
    const w = makeWorld();
    await book(w, SLOT_18);
    const day = await w.service.getAvailability(SOCIETY, AMENITY, '2026-11-04', FLAT);

    const s18 = day.slots.find((s) => s.startAt.getTime() === SLOT_18.getTime())!;
    const s19 = day.slots.find((s) => s.startAt.getTime() === SLOT_19.getTime())!;
    expect(s18).toMatchObject({ state: 'FULL', remaining: 0, bookedByMyFlat: true });
    expect(s19).toMatchObject({ state: 'AVAILABLE', remaining: 1, bookedByMyFlat: false });
    expect(day.slots).toHaveLength(16);
  });

  it("does not tell a flat a slot is 'mine' when it was booked by someone else", async () => {
    const w = makeWorld();
    await book(w, SLOT_18, resident({ flatId: OTHER_FLAT, id: 'user-2' }));
    const day = await w.service.getAvailability(SOCIETY, AMENITY, '2026-11-04', FLAT);

    expect(day.slots.find((s) => s.startAt.getTime() === SLOT_18.getTime())).toMatchObject({
      state: 'FULL',
      bookedByMyFlat: false,
    });
  });

  it('shows slots earlier today as PAST', async () => {
    const w = makeWorld();
    const today = await w.service.getAvailability(SOCIETY, AMENITY, '2026-11-01', FLAT);
    // 11:30 IST now: the 06:00 slot is gone, the 18:00 one is still ahead.
    expect(today.slots[0].state).toBe('PAST');
    expect(today.slots.find((s) => s.startAt.toISOString() === '2026-11-01T12:30:00.000Z')!.state).toBe('AVAILABLE');
  });

  it('shows days beyond the booking horizon as TOO_FAR', async () => {
    const w = makeWorld({ maxAdvanceDays: 7 });
    const far = await w.service.getAvailability(SOCIETY, AMENITY, '2026-11-20', FLAT);
    expect(far.slots.every((s) => s.state === 'TOO_FAR')).toBe(true);
  });

  it('counts only live bookings — a cancelled one frees its slot', async () => {
    const w = makeWorld({ cancelBeforeHours: 0 });
    const b = await book(w);
    await w.service.cancel(SOCIETY, resident(), b.id, false);

    const day = await w.service.getAvailability(SOCIETY, AMENITY, '2026-11-04', FLAT);
    expect(day.slots.find((s) => s.startAt.getTime() === SLOT_18.getTime())!.state).toBe('AVAILABLE');
  });

  it('reports remaining places for an amenity that holds several at once', async () => {
    const w = makeWorld({ capacity: 3 });
    await book(w, SLOT_18, resident({ flatId: 'f1', id: 'u1' }));
    await book(w, SLOT_18, resident({ flatId: 'f2', id: 'u2' }));
    const day = await w.service.getAvailability(SOCIETY, AMENITY, '2026-11-04', FLAT);

    expect(day.slots.find((s) => s.startAt.getTime() === SLOT_18.getTime())).toMatchObject({ state: 'AVAILABLE', remaining: 1 });
  });

  it('rejects a malformed date, an unknown amenity, and an inactive one', async () => {
    const w = makeWorld();
    await expect(w.service.getAvailability(SOCIETY, AMENITY, 'tomorrow', FLAT)).rejects.toThrow(BadRequestException);
    await expect(w.service.getAvailability(SOCIETY, 'nope', '2026-11-04', FLAT)).rejects.toThrow(NotFoundException);
    await expect(w.service.getAvailability(OTHER_SOCIETY, AMENITY, '2026-11-04', FLAT)).rejects.toThrow(NotFoundException);
    w.amenities[0].isActive = false;
    await expect(w.service.getAvailability(SOCIETY, AMENITY, '2026-11-04', FLAT)).rejects.toThrow(NotFoundException);
  });
});

describe('book — outcome', () => {
  it('confirms instantly and takes the flat from the signed-in membership', async () => {
    const w = makeWorld();
    const b = await book(w);

    expect(b).toMatchObject({ status: 'CONFIRMED', flatId: FLAT, userId: 'user-1', societyId: SOCIETY, feeStatus: 'NONE' });
    expect(b.endAt.toISOString()).toBe('2026-11-04T13:30:00.000Z');
    expect(w.audits.at(-1)).toMatchObject({ entityType: 'AmenityBooking', newValues: { action: 'BOOKING_CREATED', status: 'CONFIRMED' } });
  });

  it('does not bother the committee about an instant booking', async () => {
    const w = makeWorld();
    await book(w);
    expect(w.notifications.sendToUsers).not.toHaveBeenCalled();
  });

  it('holds a request for approval and tells the whole committee', async () => {
    const w = makeWorld({ bookingMode: 'NEEDS_APPROVAL' });
    const b = await book(w);

    expect(b.status).toBe('PENDING');
    const [societyId, recipients, payload] = (w.notifications.sendToUsers as jest.Mock).mock.calls[0];
    expect(societyId).toBe(SOCIETY);
    expect(recipients).toEqual([ADMIN, 'committee-2']);
    expect(payload).toMatchObject({ type: 'AMENITY_BOOKING', data: { bookingId: b.id } });
    expect(payload.title).toContain('Clubhouse');
  });

  it('snapshots the fee as due, so a later fee change does not rewrite it', async () => {
    const w = makeWorld({ fee: new Prisma.Decimal(500) });
    const b = await book(w);
    await w.service.updateAmenity(SOCIETY, AMENITY, { fee: 900 }, ADMIN);

    expect(b.feeStatus).toBe('DUE');
    expect(w.bookings[0].feeAmount.toString()).toBe('500');
  });

  it('books several consecutive slots when the amenity allows it', async () => {
    const w = makeWorld({ maxSlotsPerBooking: 3 });
    const b = await book(w, SLOT_18, resident(), { slots: 3 });
    expect(b.endAt.toISOString()).toBe('2026-11-04T15:30:00.000Z'); // 18:00 -> 21:00 IST
  });

  it('keeps the guest count and a trimmed note', async () => {
    const w = makeWorld();
    const b = await book(w, SLOT_18, resident(), { guestCount: 12, note: '  birthday  ' });
    expect(b).toMatchObject({ guestCount: 12, note: 'birthday' });
  });
});

describe('book — refusals', () => {
  it('refuses someone with no flat', async () => {
    const w = makeWorld();
    await expect(book(w, SLOT_18, resident({ flatId: undefined }))).rejects.toThrow(ForbiddenException);
    expect(w.bookings).toHaveLength(0);
  });

  it("will not book another society's amenity, or an inactive one", async () => {
    const w = makeWorld();
    await expect(
      w.service.book(OTHER_SOCIETY, resident(), { amenityId: AMENITY, startAt: SLOT_18.toISOString() } as any),
    ).rejects.toThrow(NotFoundException);
    w.amenities[0].isActive = false;
    await expect(book(w)).rejects.toThrow(NotFoundException);
  });

  it.each([
    ['between slots', new Date('2026-11-04T13:00:00Z'), /valid slot start/],
    ['before opening', new Date('2026-11-04T00:00:00Z'), /valid slot start/], // 05:30 IST
    ['after closing', new Date('2026-11-04T16:30:00Z'), /closing time/], // 22:00 IST start
    ['in the past', new Date('2026-10-31T12:30:00Z'), /already passed/],
    ['right now', NOW, /valid slot start|already passed/],
  ])('refuses a start %s', async (_label, startAt, message) => {
    const w = makeWorld();
    await expect(book(w, startAt)).rejects.toThrow(message);
    expect(w.bookings).toHaveLength(0);
  });

  it('refuses a start beyond the booking horizon', async () => {
    const w = makeWorld({ maxAdvanceDays: 2 });
    await expect(book(w, SLOT_18)).rejects.toThrow(/open 2 days ahead/);
  });

  it('refuses more slots than the amenity allows', async () => {
    const w = makeWorld({ maxSlotsPerBooking: 2 });
    await expect(book(w, SLOT_18, resident(), { slots: 3 })).rejects.toThrow(/at most 2/);
  });

  it('refuses an overlapping booking, whether it starts inside or contains the existing one', async () => {
    const w = makeWorld({ maxSlotsPerBooking: 3 });
    await book(w, SLOT_19, resident({ flatId: OTHER_FLAT, id: 'u2' }));

    // 18:00–19:00 does not overlap 19:00–20:00 ...
    await expect(book(w, SLOT_18)).resolves.toBeDefined();
    // ... but a three-slot booking from 18:00 swallows it.
    const w2 = makeWorld({ maxSlotsPerBooking: 3 });
    await book(w2, SLOT_19, resident({ flatId: OTHER_FLAT, id: 'u2' }));
    await expect(book(w2, SLOT_18, resident(), { slots: 3 })).rejects.toThrow(ConflictException);
  });

  it('lets an amenity with capacity 2 hold two overlapping bookings and refuses the third', async () => {
    const w = makeWorld({ capacity: 2 });
    await book(w, SLOT_18, resident({ flatId: 'f1', id: 'u1' }));
    await book(w, SLOT_18, resident({ flatId: 'f2', id: 'u2' }));
    await expect(book(w, SLOT_18, resident({ flatId: 'f3', id: 'u3' }))).rejects.toThrow(ConflictException);
  });

  it('counts pending requests as holding the slot', async () => {
    const w = makeWorld({ bookingMode: 'NEEDS_APPROVAL' });
    await book(w, SLOT_18, resident({ flatId: 'f1', id: 'u1' }));
    await expect(book(w, SLOT_18, resident({ flatId: 'f2', id: 'u2' }))).rejects.toThrow(ConflictException);
  });

  it('does not let a rejected or cancelled booking hold a slot', async () => {
    const w = makeWorld({ bookingMode: 'NEEDS_APPROVAL' });
    const first = await book(w, SLOT_18, resident({ flatId: 'f1', id: 'u1' }));
    await w.service.reject(SOCIETY, first.id, ADMIN, 'no');
    await expect(book(w, SLOT_18, resident({ flatId: 'f2', id: 'u2' }))).resolves.toBeDefined();
  });
});

describe('book — monthly cap', () => {
  it('stops a flat at its monthly limit, counting only that flat', async () => {
    const w = makeWorld({ monthlyCapPerFlat: 2 });
    await book(w, new Date('2026-11-04T12:30:00Z'));
    await book(w, new Date('2026-11-05T12:30:00Z'));

    await expect(book(w, new Date('2026-11-06T12:30:00Z'))).rejects.toThrow(/limit of 2/);
    // Another flat is unaffected.
    await expect(
      book(w, new Date('2026-11-06T12:30:00Z'), resident({ flatId: OTHER_FLAT, id: 'u2' })),
    ).resolves.toBeDefined();
  });

  it('counts by calendar month in India time, not by rolling window', async () => {
    const w = makeWorld({ monthlyCapPerFlat: 1 });
    await book(w, new Date('2026-11-04T12:30:00Z'));
    // 1 Dec 06:00 IST is a different month: allowed.
    await expect(book(w, new Date('2026-12-01T00:30:00Z'))).resolves.toBeDefined();
  });

  it('gives the allowance back when a booking is cancelled', async () => {
    const w = makeWorld({ monthlyCapPerFlat: 1, cancelBeforeHours: 0 });
    const b = await book(w, new Date('2026-11-04T12:30:00Z'));
    await expect(book(w, new Date('2026-11-05T12:30:00Z'))).rejects.toThrow(/limit of 1/);
    await w.service.cancel(SOCIETY, resident(), b.id, false);
    await expect(book(w, new Date('2026-11-05T12:30:00Z'))).resolves.toBeDefined();
  });
});

describe('book — the double-booking race', () => {
  it('lets exactly one of five simultaneous requests for the same slot succeed', async () => {
    const w = makeWorld();
    const attempts = Array.from({ length: 5 }, (_, i) =>
      book(w, SLOT_18, resident({ flatId: `flat-${i}`, id: `user-${i}` })),
    );

    const results = await Promise.allSettled(attempts);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const failures = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(failures).toHaveLength(4);
    failures.forEach((f) => expect(f.reason).toBeInstanceOf(ConflictException));
    expect(w.bookings).toHaveLength(1);
  });

  it('never exceeds capacity under contention for a multi-place amenity', async () => {
    const w = makeWorld({ capacity: 2 });
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => book(w, SLOT_18, resident({ flatId: `flat-${i}`, id: `user-${i}` }))),
    );

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(w.bookings).toHaveLength(2);
  });

  it('does not serialise bookings of different slots against each other into failure', async () => {
    const w = makeWorld();
    const results = await Promise.allSettled([
      book(w, new Date('2026-11-04T12:30:00Z'), resident({ flatId: 'a', id: 'ua' })),
      book(w, new Date('2026-11-04T13:30:00Z'), resident({ flatId: 'b', id: 'ub' })),
      book(w, new Date('2026-11-04T14:30:00Z'), resident({ flatId: 'c', id: 'uc' })),
    ]);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
  });
});

describe('cancel', () => {
  it('lets a resident cancel their own flat\'s booking and releases an uncollected fee', async () => {
    const w = makeWorld({ fee: new Prisma.Decimal(500) });
    const b = await book(w);

    await expect(w.service.cancel(SOCIETY, resident(), b.id, false)).resolves.toMatchObject({ status: 'CANCELLED' });
    expect(w.bookings[0]).toMatchObject({ status: 'CANCELLED', cancelledById: 'user-1', feeStatus: 'NONE' });
  });

  it('tells the committee a confirmed slot has been freed', async () => {
    const w = makeWorld();
    const b = await book(w);
    (w.notifications.sendToUsers as jest.Mock).mockClear();

    await w.service.cancel(SOCIETY, resident(), b.id, false);

    const [, recipients, payload] = (w.notifications.sendToUsers as jest.Mock).mock.calls[0];
    expect(recipients).toEqual([ADMIN, 'committee-2']);
    expect(payload.body).toMatch(/free again/);
  });

  it('refuses a resident inside the cancellation window, and says how long the window is', async () => {
    const w = makeWorld({ cancelBeforeHours: 24 });
    // Starts 18:00 IST on the 1st — about 6.5 hours from "now" (11:30 IST).
    const soon = new Date('2026-11-01T12:30:00Z');
    const b = await book(w, soon);

    await expect(w.service.cancel(SOCIETY, resident(), b.id, false)).rejects.toThrow(/at least 24 hour/);
    expect(w.bookings[0].status).toBe('CONFIRMED');
  });

  it('lets the committee cancel inside that window, and tells the booker', async () => {
    const w = makeWorld({ cancelBeforeHours: 24 });
    const soon = new Date('2026-11-01T12:30:00Z');
    const b = await book(w, soon);
    (w.notifications.sendToUsers as jest.Mock).mockClear();

    await w.service.cancel(SOCIETY, resident({ id: ADMIN, flatId: undefined }), b.id, true);

    expect(w.bookings[0].status).toBe('CANCELLED');
    const [, recipients] = (w.notifications.sendToUsers as jest.Mock).mock.calls[0];
    expect(recipients).toEqual(['user-1']);
  });

  it("treats another flat's booking as not found, so its id cannot be probed", async () => {
    const w = makeWorld();
    const b = await book(w);
    await expect(
      w.service.cancel(SOCIETY, resident({ flatId: OTHER_FLAT, id: 'u2' }), b.id, false),
    ).rejects.toThrow(NotFoundException);
    expect(w.bookings[0].status).toBe('CONFIRMED');
  });

  it("will not touch another society's booking even as committee", async () => {
    const w = makeWorld();
    const b = await book(w);
    await expect(w.service.cancel(OTHER_SOCIETY, resident({ id: ADMIN }), b.id, true)).rejects.toThrow(NotFoundException);
  });

  it('refuses a booking that is already closed or has already started', async () => {
    const w = makeWorld({ cancelBeforeHours: 0 });
    const b = await book(w);
    await w.service.cancel(SOCIETY, resident(), b.id, false);
    await expect(w.service.cancel(SOCIETY, resident(), b.id, false)).rejects.toThrow(/already closed/);

    const started = await book(w, new Date('2026-11-05T12:30:00Z'));
    jest.setSystemTime(new Date('2026-11-05T12:45:00Z'));
    await expect(w.service.cancel(SOCIETY, resident(), started.id, false)).rejects.toThrow(/already started/);
  });

  it('leaves a collected fee as collected — refunds are the committee\'s decision', async () => {
    const w = makeWorld({ fee: new Prisma.Decimal(500) });
    const b = await book(w);
    await w.service.collectFee(SOCIETY, b.id, ACCOUNT, ADMIN);
    w.amenities[0].cancelBeforeHours = 0;

    await w.service.cancel(SOCIETY, resident(), b.id, false);

    expect(w.bookings[0]).toMatchObject({ status: 'CANCELLED', feeStatus: 'COLLECTED' });
  });
});

describe('approve / reject', () => {
  async function pending() {
    const w = makeWorld({ bookingMode: 'NEEDS_APPROVAL', fee: new Prisma.Decimal(500) });
    const b = await book(w);
    (w.notifications.sendToUsers as jest.Mock).mockClear();
    return { w, b };
  }

  it('confirms a pending request and tells the booker', async () => {
    const { w, b } = await pending();
    const result = await w.service.approve(SOCIETY, b.id, ADMIN);

    expect(result).toMatchObject({ status: 'CONFIRMED', decidedById: ADMIN });
    const [, recipients, payload] = (w.notifications.sendToUsers as jest.Mock).mock.calls[0];
    expect(recipients).toEqual(['user-1']);
    expect(payload.title).toMatch(/confirmed/i);
  });

  it('declines with a reason, releases the fee, and tells the booker why', async () => {
    const { w, b } = await pending();
    const result = await w.service.reject(SOCIETY, b.id, ADMIN, '  Maintenance that day  ');

    expect(result).toMatchObject({ status: 'REJECTED', rejectionReason: 'Maintenance that day', feeStatus: 'NONE' });
    const [, , payload] = (w.notifications.sendToUsers as jest.Mock).mock.calls[0];
    expect(payload.body).toContain('Maintenance that day');
  });

  it('refuses to decide the same request twice', async () => {
    const { w, b } = await pending();
    await w.service.approve(SOCIETY, b.id, ADMIN);
    await expect(w.service.approve(SOCIETY, b.id, ADMIN)).rejects.toThrow(ConflictException);
    await expect(w.service.reject(SOCIETY, b.id, ADMIN)).rejects.toThrow(ConflictException);
    expect(w.bookings[0].status).toBe('CONFIRMED');
  });

  it('lets only one of two simultaneous decisions win', async () => {
    const { w, b } = await pending();
    const results = await Promise.allSettled([
      w.service.approve(SOCIETY, b.id, ADMIN),
      w.service.reject(SOCIETY, b.id, 'committee-2', 'no'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(['CONFIRMED', 'REJECTED']).toContain(w.bookings[0].status);
  });

  it('refuses a request whose start time has already passed', async () => {
    const { w, b } = await pending();
    jest.setSystemTime(new Date('2026-11-05T00:00:00Z'));
    await expect(w.service.approve(SOCIETY, b.id, ADMIN)).rejects.toThrow(/already started/);
  });

  it("will not decide another society's request", async () => {
    const { w, b } = await pending();
    await expect(w.service.approve(OTHER_SOCIETY, b.id, ADMIN)).rejects.toThrow(NotFoundException);
  });
});

describe('fees', () => {
  async function confirmedWithFee() {
    const w = makeWorld({ fee: new Prisma.Decimal(500) });
    const b = await book(w);
    return { w, b };
  }

  it('credits the account and writes a linked ledger row in one go', async () => {
    const { w, b } = await confirmedWithFee();
    const result = await w.service.collectFee(SOCIETY, b.id, ACCOUNT, ADMIN);

    expect(result).toMatchObject({ feeStatus: 'COLLECTED', collectedAccountId: ACCOUNT });
    expect(w.accounts.find((a) => a.id === ACCOUNT)!.currentBalance.toString()).toBe('1500');
    expect(w.transactions).toHaveLength(1);
    expect(w.transactions[0]).toMatchObject({
      societyId: SOCIETY,
      accountId: ACCOUNT,
      transactionType: 'CREDIT',
      linkedEntityType: 'AMENITY_BOOKING',
      linkedEntityId: b.id,
      createdById: ADMIN,
    });
    expect(w.transactions[0].amount.toString()).toBe('500');
    expect(w.transactions[0].balanceAfter.toString()).toBe('1500');
  });

  it('cannot collect the same fee twice', async () => {
    const { w, b } = await confirmedWithFee();
    await w.service.collectFee(SOCIETY, b.id, ACCOUNT, ADMIN);

    await expect(w.service.collectFee(SOCIETY, b.id, ACCOUNT, ADMIN)).rejects.toThrow(ConflictException);
    expect(w.accounts.find((a) => a.id === ACCOUNT)!.currentBalance.toString()).toBe('1500');
    expect(w.transactions).toHaveLength(1);
  });

  it("two simultaneous collections credit the account once", async () => {
    const { w, b } = await confirmedWithFee();
    const results = await Promise.allSettled([
      w.service.collectFee(SOCIETY, b.id, ACCOUNT, ADMIN),
      w.service.collectFee(SOCIETY, b.id, ACCOUNT, 'committee-2'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(w.accounts.find((a) => a.id === ACCOUNT)!.currentBalance.toString()).toBe('1500');
  });

  it("refuses another society's account — and the fee stays due, not half-collected", async () => {
    const { w, b } = await confirmedWithFee();
    await expect(w.service.collectFee(SOCIETY, b.id, 'account-other', ADMIN)).rejects.toThrow(NotFoundException);

    expect(w.bookings[0]).toMatchObject({ feeStatus: 'DUE', collectedAccountId: null });
    expect(w.transactions).toHaveLength(0);
  });

  it('refuses to collect on a pending request, a free booking, or a cancelled one', async () => {
    const pendingWorld = makeWorld({ bookingMode: 'NEEDS_APPROVAL', fee: new Prisma.Decimal(500) });
    const pendingBooking = await book(pendingWorld);
    await expect(pendingWorld.service.collectFee(SOCIETY, pendingBooking.id, ACCOUNT, ADMIN)).rejects.toThrow(/confirmed booking/);

    const freeWorld = makeWorld();
    const freeBooking = await book(freeWorld);
    await expect(freeWorld.service.collectFee(SOCIETY, freeBooking.id, ACCOUNT, ADMIN)).rejects.toThrow(ConflictException);

    const { w, b } = await confirmedWithFee();
    w.amenities[0].cancelBeforeHours = 0;
    await w.service.cancel(SOCIETY, resident(), b.id, false);
    await expect(w.service.collectFee(SOCIETY, b.id, ACCOUNT, ADMIN)).rejects.toThrow(/confirmed booking/);
  });

  it('waives a due fee, once', async () => {
    const { w, b } = await confirmedWithFee();
    await expect(w.service.waiveFee(SOCIETY, b.id, ADMIN)).resolves.toMatchObject({ feeStatus: 'WAIVED' });
    await expect(w.service.waiveFee(SOCIETY, b.id, ADMIN)).rejects.toThrow(NotFoundException);
    expect(w.transactions).toHaveLength(0);
  });

  it('audits both outcomes', async () => {
    const { w, b } = await confirmedWithFee();
    await w.service.collectFee(SOCIETY, b.id, ACCOUNT, ADMIN);
    expect(w.audits.at(-1)).toMatchObject({ newValues: { action: 'FEE_COLLECTED', accountId: ACCOUNT, amount: '500' } });
  });
});

describe('listing', () => {
  it("shows a flat only its own bookings", async () => {
    const w = makeWorld();
    await book(w, SLOT_18);
    await book(w, SLOT_19, resident({ flatId: OTHER_FLAT, id: 'u2' }));

    const mine = await w.service.myBookings(SOCIETY, resident());
    expect(mine.data).toHaveLength(1);
    expect(mine.data[0].flatId).toBe(FLAT);
    expect(mine.meta.total).toBe(1);
  });

  it('shows nothing, rather than everything, to someone with no flat', async () => {
    const w = makeWorld();
    await book(w);
    const none = await w.service.myBookings(SOCIETY, resident({ flatId: undefined }));
    expect(none.data).toEqual([]);
  });

  it('lets the committee filter by status and amenity, within their own society', async () => {
    const w = makeWorld({ bookingMode: 'NEEDS_APPROVAL' });
    const a = await book(w, SLOT_18, resident({ flatId: 'f1', id: 'u1' }));
    await book(w, SLOT_19, resident({ flatId: 'f2', id: 'u2' }));
    await w.service.approve(SOCIETY, a.id, ADMIN);

    const pending = await w.service.listBookings(SOCIETY, { status: 'PENDING' as any, page: 1, limit: 50 });
    expect(pending.data).toHaveLength(1);
    expect(pending.data[0]).toMatchObject({ status: 'PENDING', flat: { flatCode: 'A-101' } });

    const none = await w.service.listBookings(OTHER_SOCIETY, { page: 1, limit: 50 });
    expect(none.data).toHaveLength(0);
  });

  it('returns newest-start first with pagination meta', async () => {
    const w = makeWorld();
    await book(w, SLOT_18);
    await book(w, SLOT_19, resident({ flatId: 'f2', id: 'u2' }));
    const page = await w.service.listBookings(SOCIETY, { page: 1, limit: 50 });

    expect(page.data.map((b) => b.startAt.getTime())).toEqual([SLOT_19.getTime(), SLOT_18.getTime()]);
    expect(page.meta).toMatchObject({ total: 2, page: 1, limit: 50 });
  });
});
