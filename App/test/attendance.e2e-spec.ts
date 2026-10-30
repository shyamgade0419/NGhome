/**
 * Staff attendance, shifts and the duty roster against a REAL Postgres, through real HTTP.
 *
 * What a fake cannot prove: that a roster assignment is all-or-nothing and replaces what was
 * planned, that a person has one attendance row per day (so many guards checking the same person
 * in at once make exactly one), that the date columns and the IST day boundaries line up, and
 * that societies stay apart.
 *
 * Run with: npm run test:e2e   (needs DATABASE_URL pointing at a migrated test database)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { SystemRole } from '@prisma/client';
import * as argon2 from 'argon2';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { istDateString } from '../src/amenities/amenity-time';
import { addDays, parseDate } from '../src/attendance/attendance-rules';

jest.setTimeout(60_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const phone = (n: number) => '95' + String(UNIQUE).slice(-7) + String(n);
const TODAY = istDateString(new Date());
const MONTH = TODAY.slice(0, 7);

describe('Staff attendance (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  let adminA: string;
  let societyA: string;
  let resA: string;
  let guardA: string;
  let accountantA: string;
  let adminB: string;
  let societyB: string;
  let guardB: string;

  let ravi: string; // employees of society A
  let sita: string;
  let gopal: string;
  let retired: string; // no longer employed
  let outsider: string; // belongs to society B
  let morning: string; // shifts
  let night: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const mark = (token: string, body: Record<string, unknown>) => http().post('/api/v1/staff-attendance/mark').set(auth(token)).send(body);
  const checkIn = (token: string, id: string) => http().post(`/api/v1/gate/staff/${id}/check-in`).set(auth(token)).send({});
  const checkOut = (token: string, id: string) => http().post(`/api/v1/gate/staff/${id}/check-out`).set(auth(token)).send({});
  const emp = (societyId: string, name: string, over: Record<string, unknown> = {}) =>
    prisma.societyEmployee.create({ data: { societyId, name, designation: 'Housekeeping', baseSalary: '12000', phone: '9000000000', ...over } }).then((e) => e.id);

  async function makeUser(label: string, societyId: string, role: SystemRole): Promise<string> {
    const email = `${label}-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: { email, firstName: label, lastName: 'Test', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, flatId: null, role, status: 'ACTIVE', isPrimary: false } });
    const login = await http().post('/api/v1/auth/login').send({ identifier: email, password: PASSWORD }).expect(200);
    return login.body.data.accessToken as string;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue({ increment: async () => ({ totalHits: 1, timeToExpire: 60 }) })
      .compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }));
    await app.init();
    prisma = moduleFixture.get(PrismaService);

    const register = async (tag: string, ph: string) =>
      http()
        .post('/api/v1/auth/register-society')
        .send({
          society: { name: `E2E Staff ${tag} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-${tag}-${UNIQUE}@test.example`, contactPhone: ph },
          admin: { firstName: 'Admin', lastName: tag, email: `admin-${tag}-${UNIQUE}@test.example`, phone: ph, password: PASSWORD },
        })
        .expect(201);
    const a = await register('sa', phone(1));
    adminA = a.body.data.accessToken;
    societyA = a.body.data.memberships[0].societyId;
    const b = await register('sb', phone(2));
    adminB = b.body.data.accessToken;
    societyB = b.body.data.memberships[0].societyId;

    resA = await makeUser('sresa', societyA, SystemRole.RESIDENT);
    guardA = await makeUser('sguarda', societyA, SystemRole.SECURITY_GUARD);
    accountantA = await makeUser('saccta', societyA, SystemRole.SOCIETY_ACCOUNTANT);
    guardB = await makeUser('sguardb', societyB, SystemRole.SECURITY_GUARD);

    ravi = await emp(societyA, 'Ravi Kumar', { designation: 'Security' });
    sita = await emp(societyA, 'Sita Devi');
    gopal = await emp(societyA, 'Gopal Rao', { designation: 'Gardener' });
    retired = await emp(societyA, 'Old Hand', { isActive: false });
    outsider = await emp(societyB, 'Other Society Staff');
  });

  afterAll(async () => {
    if (societyA) await prisma.society.update({ where: { id: societyA }, data: { deletedAt: new Date() } });
    if (societyB) await prisma.society.update({ where: { id: societyB }, data: { deletedAt: new Date() } });
    await app.close();
  });

  describe('the migration, on a real database', () => {
    it('refuses a shift with equal or out-of-range times (CHECK constraint)', async () => {
      for (const [startMinute, endMinute] of [[360, 360], [-1, 100], [100, 1440]]) {
        await expect(prisma.staffShift.create({ data: { societyId: societyA, name: `bad-${startMinute}-${endMinute}`, startMinute, endMinute } })).rejects.toThrow();
      }
    });

    it('refuses an exit before the entry, and an exit with no entry (CHECK constraint)', async () => {
      const date = parseDate(TODAY)!;
      await expect(
        prisma.staffAttendance.create({ data: { societyId: societyA, employeeId: ravi, date: parseDate(addDays(TODAY, -3))!, checkInAt: new Date(), checkOutAt: new Date(Date.now() - 3_600_000) } }),
      ).rejects.toThrow();
      await expect(prisma.staffAttendance.create({ data: { societyId: societyA, employeeId: ravi, date, checkOutAt: new Date() } })).rejects.toThrow();
    });

    it('allows one attendance row and one roster row per person per day (unique indexes)', async () => {
      const date = parseDate(addDays(TODAY, -4))!;
      await prisma.staffAttendance.create({ data: { societyId: societyA, employeeId: sita, date } });
      await expect(prisma.staffAttendance.create({ data: { societyId: societyA, employeeId: sita, date } })).rejects.toThrow();
      await prisma.staffAttendance.deleteMany({ where: { employeeId: sita, date } });
    });
  });

  describe('shifts', () => {
    it('the committee adds shifts; a night shift is flagged as overnight', async () => {
      const m = await http().post('/api/v1/staff-shifts').set(auth(adminA)).send({ name: 'Morning', startTime: '06:00', endTime: '14:00' }).expect(201);
      expect(m.body.data).toMatchObject({ name: 'Morning', startTime: '06:00', endTime: '14:00', startMinute: 360, overnight: false, active: true });
      morning = m.body.data.id;
      const n = await http().post('/api/v1/staff-shifts').set(auth(adminA)).send({ name: 'Night', startTime: '22:00', endTime: '06:00' }).expect(201);
      expect(n.body.data.overnight).toBe(true);
      night = n.body.data.id;
    });

    it('refuses a repeated name, equal times, and anyone but the committee', async () => {
      await http().post('/api/v1/staff-shifts').set(auth(adminA)).send({ name: 'Morning', startTime: '07:00', endTime: '15:00' }).expect(409);
      await http().post('/api/v1/staff-shifts').set(auth(adminA)).send({ name: 'Odd', startTime: '07:00', endTime: '07:00' }).expect(400);
      for (const t of [resA, guardA, accountantA]) {
        await http().post('/api/v1/staff-shifts').set(auth(t)).send({ name: 'Nope', startTime: '07:00', endTime: '15:00' }).expect(403);
        await http().get('/api/v1/staff-shifts').set(auth(t)).expect(403);
      }
      const other = await http().post('/api/v1/staff-shifts').set(auth(adminB)).send({ name: 'Morning', startTime: '06:00', endTime: '14:00' }).expect(201); // another society may reuse a name
      expect(other.body.data.id).not.toBe(morning);
    });

    it('changes a shift, validating the result; another society cannot touch it', async () => {
      await http().patch(`/api/v1/staff-shifts/${morning}`).set(auth(adminA)).send({ startTime: '14:00' }).expect(400); // would equal the end
      await http().patch(`/api/v1/staff-shifts/${morning}`).set(auth(adminB)).send({ startTime: '07:00' }).expect(404);
      const res = await http().patch(`/api/v1/staff-shifts/${morning}`).set(auth(adminA)).send({ endTime: '14:30' }).expect(200);
      expect(res.body.data).toMatchObject({ startTime: '06:00', endTime: '14:30' });
      await http().patch(`/api/v1/staff-shifts/${morning}`).set(auth(adminA)).send({ endTime: '14:00' }).expect(200);
    });
  });

  describe('the duty roster', () => {
    it('lists who can be rostered: active staff only, names and designations, never pay', async () => {
      const res = await http().get('/api/v1/staff-attendance/staff').set(auth(adminA)).expect(200);
      expect(res.body.data.map((e: any) => e.id).sort()).toEqual([ravi, sita, gopal].sort());
      expect(JSON.stringify(res.body)).not.toMatch(/baseSalary|phone|email/);
    });

    it('puts people on a shift for a range, replacing what was planned', async () => {
      const to = addDays(TODAY, 6);
      const res = await http().post('/api/v1/staff-roster/assign').set(auth(adminA)).send({ employeeIds: [ravi, sita], from: TODAY, to, shiftId: morning, post: 'Main gate' }).expect(200);
      expect(res.body.data).toEqual({ assigned: 14, days: 7 });

      const got = await http().get(`/api/v1/staff-roster?from=${TODAY}&to=${to}`).set(auth(adminA)).expect(200);
      expect(got.body.data).toHaveLength(14);
      expect(got.body.data[0]).toMatchObject({ post: 'Main gate', dayOff: false, shift: { name: 'Morning' } });

      // Re-assigning one of those days replaces it: Sita now has the day off.
      const off = addDays(TODAY, 2);
      await http().post('/api/v1/staff-roster/assign').set(auth(adminA)).send({ employeeIds: [sita], from: off, to: off }).expect(200);
      const after = await http().get(`/api/v1/staff-roster?from=${off}&to=${off}`).set(auth(adminA)).expect(200);
      const s = after.body.data.find((r: any) => r.employeeId === sita);
      expect(s).toMatchObject({ dayOff: true, shift: null, post: null });
      expect(await prisma.staffRoster.count({ where: { employeeId: sita, date: parseDate(off)! } })).toBe(1);
    });

    it('can limit an assignment to certain weekdays', async () => {
      const from = addDays(TODAY, 20);
      const to = addDays(TODAY, 26); // exactly one week
      const res = await http().post('/api/v1/staff-roster/assign').set(auth(adminA)).send({ employeeIds: [gopal], from, to, shiftId: night, weekdays: [1, 2, 3] }).expect(200);
      expect(res.body.data.days).toBe(3);
      const rows = await prisma.staffRoster.findMany({ where: { employeeId: gopal, date: { gte: parseDate(from)!, lte: parseDate(to)! } } });
      expect(rows).toHaveLength(3);
      await http().post('/api/v1/staff-roster/assign').set(auth(adminA)).send({ employeeIds: [gopal], from, to: from, shiftId: night, weekdays: [(((new Date(`${from}T00:00:00Z`).getUTCDay()) + 1) % 7)] }).expect(400);
    });

    it('refuses bad requests and changes nothing: unknown people, a retired shift, bad ranges, too many cells', async () => {
      const before = await prisma.staffRoster.count({ where: { societyId: societyA } });
      const to = addDays(TODAY, 3);
      await http().post('/api/v1/staff-roster/assign').set(auth(adminA)).send({ employeeIds: [ravi, outsider], from: TODAY, to, shiftId: morning }).expect(404); // one is another society's
      await http().post('/api/v1/staff-roster/assign').set(auth(adminA)).send({ employeeIds: [retired], from: TODAY, to, shiftId: morning }).expect(404);
      await http().post('/api/v1/staff-roster/assign').set(auth(adminA)).send({ employeeIds: [ravi], from: TODAY, to, shiftId: '11111111-1111-4111-8111-111111111111' }).expect(404);
      await http().post('/api/v1/staff-roster/assign').set(auth(adminA)).send({ employeeIds: [ravi], from: to, to: TODAY, shiftId: morning }).expect(400);
      await http().post('/api/v1/staff-roster/assign').set(auth(adminA)).send({ employeeIds: [ravi], from: addDays(TODAY, -90), to: TODAY, shiftId: morning }).expect(400);
      await http().post('/api/v1/staff-roster/assign').set(auth(adminA)).send({ employeeIds: [ravi], from: TODAY, to: addDays(TODAY, 100), shiftId: morning }).expect(400);

      const spare = await Promise.all(Array.from({ length: 9 }, (_, i) => emp(societyA, `Spare ${i}`, { isActive: true })));
      const huge = await http().post('/api/v1/staff-roster/assign').set(auth(adminA)).send({ employeeIds: spare, from: TODAY, to: addDays(TODAY, 61), shiftId: morning }).expect(400);
      expect(huge.body.message).toMatch(/too many/);
      await prisma.societyEmployee.deleteMany({ where: { id: { in: spare } } });

      expect(await prisma.staffRoster.count({ where: { societyId: societyA } })).toBe(before);
    });

    it('retiring a shift stops it being assigned, but keeps it in history', async () => {
      const temp = (await http().post('/api/v1/staff-shifts').set(auth(adminA)).send({ name: 'Temp', startTime: '10:00', endTime: '12:00' }).expect(201)).body.data.id;
      await http().post('/api/v1/staff-roster/assign').set(auth(adminA)).send({ employeeIds: [ravi], from: addDays(TODAY, 30), to: addDays(TODAY, 30), shiftId: temp }).expect(200);
      await http().patch(`/api/v1/staff-shifts/${temp}`).set(auth(adminA)).send({ active: false }).expect(200);
      await http().post('/api/v1/staff-roster/assign').set(auth(adminA)).send({ employeeIds: [sita], from: addDays(TODAY, 31), to: addDays(TODAY, 31), shiftId: temp }).expect(404);
      const kept = await http().get(`/api/v1/staff-roster?from=${addDays(TODAY, 30)}&to=${addDays(TODAY, 30)}`).set(auth(adminA)).expect(200);
      expect(kept.body.data[0].shift).toMatchObject({ name: 'Temp', active: false });
    });

    it('clears a range; only the committee of that society may', async () => {
      const day = addDays(TODAY, 30);
      await http().post('/api/v1/staff-roster/clear').set(auth(guardA)).send({ employeeIds: [ravi], from: day, to: day }).expect(403);
      await http().post('/api/v1/staff-roster/clear').set(auth(adminB)).send({ employeeIds: [ravi], from: day, to: day }).expect(404);
      const res = await http().post('/api/v1/staff-roster/clear').set(auth(adminA)).send({ employeeIds: [ravi], from: day, to: day }).expect(200);
      expect(res.body.data.cleared).toBe(1);
    });
  });

  describe('the committee marks attendance', () => {
    it('records a day with times; a check-in within the grace period is not late, a later one is', async () => {
      const r = await mark(adminA, { employeeId: ravi, date: TODAY, status: 'PRESENT', checkIn: '06:05', checkOut: '14:10' }).expect(200);
      expect(r.body.data).toMatchObject({ status: 'PRESENT', late: false, workedMinutes: 485 });
      const s = await mark(adminA, { employeeId: sita, date: TODAY, status: 'PRESENT', checkIn: '06:40' }).expect(200);
      expect(s.body.data).toMatchObject({ late: true, checkOutAt: null, workedMinutes: null });
    });

    it('a night shift check-out earlier than the check-in is the next morning', async () => {
      const day = addDays(TODAY, -1);
      const res = await mark(adminA, { employeeId: gopal, date: day, status: 'PRESENT', checkIn: '22:00', checkOut: '06:00' }).expect(200);
      expect(res.body.data.workedMinutes).toBe(480);
    });

    it('absent and leave carry no times, and correcting a day replaces it', async () => {
      const day = addDays(TODAY, -2);
      await mark(adminA, { employeeId: ravi, date: day, status: 'PRESENT', checkIn: '06:00', checkOut: '14:00' }).expect(200);
      const res = await mark(adminA, { employeeId: ravi, date: day, status: 'ABSENT', checkIn: '06:00', note: 'No call' }).expect(200);
      expect(res.body.data).toMatchObject({ status: 'ABSENT', checkInAt: null, checkOutAt: null, note: 'No call' });
      expect(await prisma.staffAttendance.count({ where: { employeeId: ravi, date: parseDate(day)! } })).toBe(1);
    });

    it('refuses the future, dates too far back, a check-out with no check-in, retired staff, and other societies’ staff', async () => {
      await mark(adminA, { employeeId: ravi, date: addDays(TODAY, 1), status: 'PRESENT' }).expect(400);
      await mark(adminA, { employeeId: ravi, date: addDays(TODAY, -63), status: 'PRESENT' }).expect(400);
      await mark(adminA, { employeeId: ravi, date: TODAY, status: 'PRESENT', checkOut: '14:00' }).expect(400);
      await mark(adminA, { employeeId: retired, date: TODAY, status: 'PRESENT' }).expect(404);
      await mark(adminA, { employeeId: outsider, date: TODAY, status: 'PRESENT' }).expect(404);
      await mark(adminB, { employeeId: ravi, date: TODAY, status: 'PRESENT' }).expect(404);
      for (const t of [resA, guardA, accountantA]) await mark(t, { employeeId: ravi, date: TODAY, status: 'PRESENT' }).expect(403);
    });

    it('marks everyone at once without wiping times already recorded; absent clears them', async () => {
      const day = addDays(TODAY, -5);
      await mark(adminA, { employeeId: ravi, date: day, status: 'PRESENT', checkIn: '06:00', checkOut: '14:00' }).expect(200);
      await http().post('/api/v1/staff-attendance/mark-day').set(auth(adminA)).send({ date: day, entries: [{ employeeId: ravi, status: 'PRESENT' }, { employeeId: sita, status: 'PRESENT' }, { employeeId: gopal, status: 'LEAVE' }] }).expect(200);
      const rows = await prisma.staffAttendance.findMany({ where: { societyId: societyA, date: parseDate(day)! } });
      const by = (id: string) => rows.find((r) => r.employeeId === id)!;
      expect(by(ravi).checkInAt).not.toBeNull(); // kept
      expect(by(sita).status).toBe('PRESENT');
      expect(by(gopal).status).toBe('LEAVE');

      await http().post('/api/v1/staff-attendance/mark-day').set(auth(adminA)).send({ date: day, entries: [{ employeeId: ravi, status: 'ABSENT' }] }).expect(200);
      expect((await prisma.staffAttendance.findFirstOrThrow({ where: { employeeId: ravi, date: parseDate(day)! } })).checkInAt).toBeNull();

      await http().post('/api/v1/staff-attendance/mark-day').set(auth(adminA)).send({ date: day, entries: [{ employeeId: ravi, status: 'PRESENT' }, { employeeId: ravi, status: 'ABSENT' }] }).expect(400);
      const before = await prisma.staffAttendance.count({ where: { societyId: societyA } });
      await http().post('/api/v1/staff-attendance/mark-day').set(auth(adminA)).send({ date: day, entries: [{ employeeId: sita, status: 'ABSENT' }, { employeeId: outsider, status: 'PRESENT' }] }).expect(404);
      expect((await prisma.staffAttendance.findFirstOrThrow({ where: { employeeId: sita, date: parseDate(day)! } })).status).toBe('PRESENT'); // the valid half was not applied
      expect(await prisma.staffAttendance.count({ where: { societyId: societyA } })).toBe(before);
    });

    it('shows the day: each active person with their shift and what was recorded', async () => {
      const res = await http().get(`/api/v1/staff-attendance/day?date=${TODAY}`).set(auth(adminA)).expect(200);
      const rows = res.body.data.rows;
      expect(rows.map((r: any) => r.employeeId)).not.toContain(retired);
      expect(rows.map((r: any) => r.employeeId)).not.toContain(outsider);
      const r = rows.find((x: any) => x.employeeId === ravi);
      expect(r).toMatchObject({ name: 'Ravi Kumar', post: 'Main gate', shift: { name: 'Morning' }, attendance: { status: 'PRESENT', late: false } });
      expect(rows.find((x: any) => x.employeeId === sita).attendance.late).toBe(true);
      expect(JSON.stringify(res.body)).not.toMatch(/baseSalary|phone/);
      await http().get('/api/v1/staff-attendance/day?date=nope').set(auth(adminA)).expect(400);
    });
  });

  describe('at the gate', () => {
    it('the guard sees names, posts and shifts, never pay or phone numbers', async () => {
      const res = await http().get('/api/v1/gate/staff').set(auth(guardA)).expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/baseSalary|phone|email|salary/i);
      const ids = res.body.data.map((r: any) => r.employeeId);
      expect(ids).toContain(ravi);
      expect(ids).not.toContain(retired);
      expect(ids).not.toContain(outsider);
      expect(res.body.data[0].shiftName).not.toBeNull(); // rostered people come first
      const r = res.body.data.find((x: any) => x.employeeId === ravi);
      expect(r).toMatchObject({ shiftName: 'Morning', shiftStart: '06:00', shiftEnd: '14:00', post: 'Main gate' });
    });

    it('checks a person in; a repeat returns the same; the committee-marked time is kept', async () => {
      const res = await checkIn(guardA, gopal).expect(200);
      expect(res.body.data.alreadyIn).toBe(false);
      expect(res.body.data.attendance).toMatchObject({ status: 'PRESENT', date: TODAY });
      expect(res.body.data.attendance.checkInAt).not.toBeNull();
      const again = await checkIn(guardA, gopal).expect(200);
      expect(again.body.data.alreadyIn).toBe(true);
      expect(again.body.data.attendance.checkInAt).toBe(res.body.data.attendance.checkInAt);
      expect(await prisma.staffAttendance.count({ where: { employeeId: gopal, date: parseDate(TODAY)! } })).toBe(1);
    });

    it('many guards checking the same person in at once make exactly one record', async () => {
      const fresh = await emp(societyA, 'Race Staff');
      const results = await Promise.all(Array.from({ length: 8 }, () => checkIn(guardA, fresh)));
      results.forEach((r) => expect(r.status).toBe(200));
      expect(results.filter((r) => r.body.data.alreadyIn === false)).toHaveLength(1);
      expect(await prisma.staffAttendance.count({ where: { employeeId: fresh, date: parseDate(TODAY)! } })).toBe(1);
      const times = new Set(results.map((r) => r.body.data.attendance.checkInAt));
      expect(times.size).toBe(1);
      await checkOut(guardA, fresh).expect(200);
    });

    it('a check-in over a day the committee marked absent makes it present; a half day stays one', async () => {
      const a = await emp(societyA, 'Marked Absent');
      const h = await emp(societyA, 'Marked Half');
      await mark(adminA, { employeeId: a, date: TODAY, status: 'ABSENT' }).expect(200);
      await mark(adminA, { employeeId: h, date: TODAY, status: 'HALF_DAY' }).expect(200);
      const ra = await checkIn(guardA, a).expect(200);
      expect(ra.body.data.attendance.status).toBe('PRESENT');
      expect(ra.body.data.attendance.checkInAt).not.toBeNull();
      const rh = await checkIn(guardA, h).expect(200);
      expect(rh.body.data.attendance.status).toBe('HALF_DAY');
    });

    it('records the exit once, however many press it', async () => {
      const [x, y] = await Promise.all([checkOut(guardA, gopal), checkOut(guardA, gopal)]);
      expect([x.status, y.status]).toEqual([200, 200]);
      expect([x.body.data.alreadyOut, y.body.data.alreadyOut].sort()).toEqual([false, true]);
      const row = await prisma.staffAttendance.findFirstOrThrow({ where: { employeeId: gopal, date: parseDate(TODAY)! } });
      expect(row.checkOutAt).not.toBeNull();
      expect(row.checkedOutById).not.toBeNull();
      const logged = await prisma.auditLog.count({ where: { societyId: societyA, entityId: row.id, entityType: 'StaffAttendance' } });
      expect(logged).toBe(2); // one check-in, one check-out
    });

    it('cannot check out someone who was never checked in', async () => {
      const never = await emp(societyA, 'Never In');
      const res = await checkOut(guardA, never).expect(409);
      expect(res.body.message).toMatch(/not been checked in/);
    });

    it('a night shift still open from yesterday shows as inside and can be closed', async () => {
      const night1 = await emp(societyA, 'Night Watch');
      const yesterday = addDays(TODAY, -1);
      await prisma.staffAttendance.create({ data: { societyId: societyA, employeeId: night1, date: parseDate(yesterday)!, checkInAt: new Date(Date.now() - 5 * 3_600_000) } });
      const list = await http().get('/api/v1/gate/staff').set(auth(guardA)).expect(200);
      expect(list.body.data.find((r: any) => r.employeeId === night1)).toMatchObject({ inside: true });
      const out = await checkOut(guardA, night1).expect(200);
      expect(out.body.data.attendance).toMatchObject({ date: yesterday });
      expect(out.body.data.attendance.checkOutAt).not.toBeNull();
    });

    it('an old unclosed check-in is not "inside" for ever', async () => {
      const forgot = await emp(societyA, 'Forgot Exit');
      await prisma.staffAttendance.create({ data: { societyId: societyA, employeeId: forgot, date: parseDate(addDays(TODAY, -1))!, checkInAt: new Date(Date.now() - 20 * 3_600_000) } });
      const list = await http().get('/api/v1/gate/staff').set(auth(guardA)).expect(200);
      expect(list.body.data.find((r: any) => r.employeeId === forgot).inside).toBe(false);
      await checkOut(guardA, forgot).expect(409);
    });

    it('is refused to residents and accountants; another society cannot reach our staff', async () => {
      for (const t of [resA, accountantA]) {
        await http().get('/api/v1/gate/staff').set(auth(t)).expect(403);
        await checkIn(t, ravi).expect(403);
      }
      await checkIn(guardB, ravi).expect(404);
      await checkOut(guardB, ravi).expect(404);
      await checkIn(guardA, outsider).expect(404);
      await checkIn(guardA, retired).expect(404);
      const b = await http().get('/api/v1/gate/staff').set(auth(guardB)).expect(200);
      expect(b.body.data.map((r: any) => r.employeeId)).toEqual([outsider]);
    });
  });

  describe('the monthly summary', () => {
    it('counts what was marked, what is blank, and who was late, for the month so far', async () => {
      const res = await http().get(`/api/v1/staff-attendance/summary?month=${MONTH}`).set(auth(adminA)).expect(200);
      expect(res.body.data.month).toBe(MONTH);
      expect(res.body.data.through).toBe(TODAY);
      const row = (id: string) => res.body.data.rows.find((r: any) => r.employeeId === id);
      expect(row(sita).late).toBeGreaterThanOrEqual(1);
      expect(row(ravi).present + row(ravi).absent + row(ravi).leave + row(ravi).halfDay + row(ravi).unmarked + row(ravi).scheduledOff).toBeGreaterThan(0);
      expect(res.body.data.rows.map((r: any) => r.employeeId)).not.toContain(outsider);
      expect(JSON.stringify(res.body)).not.toMatch(/baseSalary|phone/);
    });

    it('a future month has nothing counted yet', async () => {
      const next = addDays(TODAY.slice(0, 7) + '-01', 40).slice(0, 7);
      const res = await http().get(`/api/v1/staff-attendance/summary?month=${next}`).set(auth(adminA)).expect(200);
      expect(res.body.data.through).toBeNull();
      expect(res.body.data.rows.every((r: any) => r.present === 0 && r.unmarked === 0)).toBe(true);
    });

    it('shows one person’s month day by day', async () => {
      const res = await http().get(`/api/v1/staff-attendance/employee/${ravi}?month=${MONTH}`).set(auth(adminA)).expect(200);
      expect(res.body.data.employee).toMatchObject({ id: ravi, name: 'Ravi Kumar' });
      expect(res.body.data.days.length).toBeGreaterThanOrEqual(28);
      const today = res.body.data.days.find((d: any) => d.date === TODAY);
      expect(today).toMatchObject({ shift: { name: 'Morning' }, attendance: { status: 'PRESENT' } });
      await http().get(`/api/v1/staff-attendance/employee/${ravi}?month=${MONTH}`).set(auth(adminB)).expect(404);
    });

    it('refuses a bad month, and anyone but the committee', async () => {
      await http().get('/api/v1/staff-attendance/summary?month=2026-13').set(auth(adminA)).expect(400);
      await http().get('/api/v1/staff-attendance/summary').set(auth(adminA)).expect(400);
      for (const t of [resA, guardA, accountantA]) await http().get(`/api/v1/staff-attendance/summary?month=${MONTH}`).set(auth(t)).expect(403);
    });
  });

  describe('the audit trail', () => {
    it('records who did what', async () => {
      const rows = await prisma.auditLog.findMany({ where: { societyId: societyA, entityType: { in: ['StaffShift', 'StaffRoster', 'StaffAttendance'] } } });
      const actions = new Set(rows.map((r) => (r.newValues as any)?.action));
      for (const a of ['SHIFT_CREATED', 'SHIFT_UPDATED', 'ROSTER_ASSIGNED', 'ROSTER_DAY_OFF', 'ROSTER_CLEARED', 'ATTENDANCE_MARKED', 'ATTENDANCE_MARKED_DAY', 'STAFF_CHECKED_IN', 'STAFF_CHECKED_OUT']) {
        expect(actions).toContain(a);
      }
    });
  });
});
