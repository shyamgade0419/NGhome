/**
 * Vehicles and parking against a REAL Postgres, through real HTTP.
 *
 * What a fake cannot prove: that a number plate is live on one flat only (a partial unique index,
 * so two flats registering the same plate at once cannot both win), that a removed vehicle frees
 * its plate, that two committee members allocating the same slot cannot both succeed, and that
 * societies stay apart.
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

jest.setTimeout(60_000);

const UNIQUE = Date.now();
const PASSWORD = 'TestPass123!';
const phone = (n: number) => '94' + String(UNIQUE).slice(-7) + String(n);
/** Plates unique to this run, so reruns on one database do not collide. */
const tail = String(UNIQUE).slice(-4);

describe('Vehicles and parking (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  let adminA: string;
  let societyA: string;
  let flatA1: string;
  let flatA2: string;
  let resA1: string;
  let resA2: string;
  let guardA: string;
  let adminB: string;
  let societyB: string;
  let flatB1: string;
  let guardB: string;
  let resB1: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const addVehicle = (token: string, body: Record<string, unknown>) => http().post('/api/v1/vehicles').set(auth(token)).send(body);
  const makeSlot = (token: string, body: Record<string, unknown>) => http().post('/api/v1/parking-slots').set(auth(token)).send(body);
  const allocate = (token: string, slotId: string, flatId: string) => http().post(`/api/v1/parking-slots/${slotId}/allocate`).set(auth(token)).send({ flatId });
  const assign = (token: string, slotId: string, vehicleId: string | null) => http().post(`/api/v1/parking/${slotId}/assign-vehicle`).set(auth(token)).send({ vehicleId });
  const lookup = (token: string, search: string) => http().get(`/api/v1/gate/vehicles/lookup?search=${encodeURIComponent(search)}`).set(auth(token));

  async function makeUser(label: string, societyId: string, role: SystemRole, flatId: string | null): Promise<string> {
    const email = `${label}-${UNIQUE}@test.example`;
    const user = await prisma.user.create({
      data: { email, firstName: label, lastName: 'Test', passwordHash: await argon2.hash(PASSWORD), isActive: true, emailVerified: true },
    });
    await prisma.societyMembership.create({ data: { societyId, userId: user.id, flatId, role, status: 'ACTIVE', isPrimary: role === SystemRole.RESIDENT } });
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
          society: { name: `E2E Parking ${tag} ${UNIQUE}`, address: '1 Street', city: 'Chennai', state: 'TN', pinCode: '600001', country: 'India', contactEmail: `soc-${tag}-${UNIQUE}@test.example`, contactPhone: ph },
          admin: { firstName: 'Admin', lastName: tag, email: `admin-${tag}-${UNIQUE}@test.example`, phone: ph, password: PASSWORD },
        })
        .expect(201);
    const a = await register('va', phone(1));
    adminA = a.body.data.accessToken;
    societyA = a.body.data.memberships[0].societyId;
    const b = await register('vb', phone(2));
    adminB = b.body.data.accessToken;
    societyB = b.body.data.memberships[0].societyId;

    const bA = await http().post('/api/v1/buildings').set(auth(adminA)).send({ name: 'VA', code: 'VA' }).expect(201);
    flatA1 = (await http().post('/api/v1/flats').set(auth(adminA)).send({ buildingId: bA.body.data.id, unitNumber: '101', flatCode: 'VA-101' }).expect(201)).body.data.id;
    flatA2 = (await http().post('/api/v1/flats').set(auth(adminA)).send({ buildingId: bA.body.data.id, unitNumber: '102', flatCode: 'VA-102' }).expect(201)).body.data.id;
    const bB = await http().post('/api/v1/buildings').set(auth(adminB)).send({ name: 'VB', code: 'VB' }).expect(201);
    flatB1 = (await http().post('/api/v1/flats').set(auth(adminB)).send({ buildingId: bB.body.data.id, unitNumber: '101', flatCode: 'VB-101' }).expect(201)).body.data.id;

    resA1 = await makeUser('vresa1', societyA, SystemRole.RESIDENT, flatA1);
    resA2 = await makeUser('vresa2', societyA, SystemRole.RESIDENT, flatA2);
    guardA = await makeUser('vguarda', societyA, SystemRole.SECURITY_GUARD, null);
    guardB = await makeUser('vguardb', societyB, SystemRole.SECURITY_GUARD, null);
    resB1 = await makeUser('vresb1', societyB, SystemRole.RESIDENT, flatB1);
  });

  afterAll(async () => {
    if (societyA) await prisma.society.update({ where: { id: societyA }, data: { deletedAt: new Date() } });
    if (societyB) await prisma.society.update({ where: { id: societyB }, data: { deletedAt: new Date() } });
    await app.close();
  });

  let car1: string; // A1's car
  let bike1: string; // A1's two-wheeler

  describe('the migration, on a real database', () => {
    it('refuses a plate that is not 4-12 upper-case letters and digits (CHECK constraint)', async () => {
      for (const bad of ['ab12', 'AB 1234', 'AB1', 'A'.repeat(13)]) {
        await expect(prisma.vehicle.create({ data: { societyId: societyA, flatId: flatA1, plate: bad, kind: 'CAR', createdById: 'x' } })).rejects.toThrow();
      }
    });

    it('allows one live plate per society, but a removed one frees it (partial unique index)', async () => {
      const p = `ZZ${tail}01`;
      const first = await prisma.vehicle.create({ data: { societyId: societyA, flatId: flatA1, plate: p, kind: 'CAR', createdById: 'x' } });
      await expect(prisma.vehicle.create({ data: { societyId: societyA, flatId: flatA2, plate: p, kind: 'CAR', createdById: 'x' } })).rejects.toThrow();
      await prisma.vehicle.update({ where: { id: first.id }, data: { active: false } });
      await expect(prisma.vehicle.create({ data: { societyId: societyA, flatId: flatA2, plate: p, kind: 'CAR', createdById: 'x' } })).resolves.toBeDefined();
      // The same plate in another society is a different vehicle.
      await expect(prisma.vehicle.create({ data: { societyId: societyB, flatId: flatB1, plate: p, kind: 'CAR', createdById: 'x' } })).resolves.toBeDefined();
      // These were only for the constraint check: remove them so later counts per flat are exact.
      await prisma.vehicle.deleteMany({ where: { plate: p } });
    });

    it('refuses a visitor slot that belongs to a flat (CHECK constraint) and a repeated slot code', async () => {
      await expect(prisma.parkingSlot.create({ data: { societyId: societyA, code: `V-chk-${UNIQUE}`, visitor: true, flatId: flatA1 } })).rejects.toThrow();
      await prisma.parkingSlot.create({ data: { societyId: societyA, code: `DUP-${UNIQUE}` } });
      await expect(prisma.parkingSlot.create({ data: { societyId: societyA, code: `DUP-${UNIQUE}` } })).rejects.toThrow();
    });
  });

  describe('registering a vehicle', () => {
    it('a resident registers one for their own flat, the plate tidied', async () => {
      const res = await addVehicle(resA1, { plate: ` ts09 ab-${tail}01`, kind: 'CAR', make: 'Maruti Swift', colour: 'White' }).expect(201);
      expect(res.body.data.plate).toBe(`TS09AB${tail}01`);
      expect(res.body.data.flatId).toBe(flatA1);
      expect(res.body.data.active).toBe(true);
      car1 = res.body.data.id;
      const b = await addVehicle(resA1, { plate: `TS09AB${tail}02`, kind: 'TWO_WHEELER' }).expect(201);
      bike1 = b.body.data.id;

      const mine = await http().get('/api/v1/vehicles/my').set(auth(resA1)).expect(200);
      expect(mine.body.data.map((v: any) => v.id).sort()).toEqual([car1, bike1].sort());
      const other = await http().get('/api/v1/vehicles/my').set(auth(resA2)).expect(200);
      expect(other.body.data).toHaveLength(0);
    });

    it('the flat cannot be chosen by the request, and a guard cannot act as a household', async () => {
      await addVehicle(resA1, { plate: `TS09AB${tail}03`, kind: 'CAR', flatId: flatA2 }).expect(400);
      await addVehicle(guardA, { plate: `TS09AB${tail}03`, kind: 'CAR' }).expect(403);
      await http().get('/api/v1/vehicles/my').set(auth(guardA)).expect(403);
    });

    it('the same plate, typed differently, is refused without saying whose it is', async () => {
      const res = await addVehicle(resA2, { plate: `ts-09-ab-${tail}-01`, kind: 'CAR' }).expect(409);
      expect(res.body.message).toMatch(/already registered/);
      expect(res.body.message).not.toMatch(/VA-101|flat/i);
    });

    it('the same plate in another society is a different vehicle', async () => {
      await addVehicle(resB1, { plate: `TS09AB${tail}01`, kind: 'CAR' }).expect(201);
    });

    it('two flats registering the same new plate at once: exactly one wins', async () => {
      const p = `TS09CD${tail}`;
      const [a, b] = await Promise.all([addVehicle(resA1, { plate: p, kind: 'CAR' }), addVehicle(resA2, { plate: p, kind: 'CAR' })]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      expect(await prisma.vehicle.count({ where: { societyId: societyA, plate: p, active: true } })).toBe(1);
      // Tidy up so later counts are predictable.
      const winner = a.status === 201 ? { token: resA1, id: a.body.data.id } : { token: resA2, id: b.body.data.id };
      await http().post(`/api/v1/vehicles/${winner.id}/remove`).set(auth(winner.token)).send({}).expect(200);
    });

    it('a flat may have at most six vehicles', async () => {
      // A2 starts with none.
      for (let i = 1; i <= 6; i++) await addVehicle(resA2, { plate: `TS09EF${tail}${i}`, kind: 'CYCLE' }).expect(201);
      const res = await addVehicle(resA2, { plate: `TS09EF${tail}7`, kind: 'CYCLE' }).expect(400);
      expect(res.body.message).toMatch(/at most 6/);
    });

    it('removing one frees the plate for another flat, and leaves the history', async () => {
      const list = await http().get('/api/v1/vehicles/my').set(auth(resA2)).expect(200);
      const victim = list.body.data.find((v: any) => v.plate === `TS09EF${tail}1`);
      await http().post(`/api/v1/vehicles/${victim.id}/remove`).set(auth(resA1)).send({}).expect(404); // not A1's
      await http().post(`/api/v1/vehicles/${victim.id}/remove`).set(auth(resA2)).send({ reason: 'Sold' }).expect(200);
      await http().post(`/api/v1/vehicles/${victim.id}/remove`).set(auth(resA2)).send({}).expect(404); // already gone
      const row = await prisma.vehicle.findUniqueOrThrow({ where: { id: victim.id } });
      expect(row).toMatchObject({ active: false, removedReason: 'Sold' });
      expect(row.removedAt).not.toBeNull();

      await addVehicle(resA1, { plate: `TS09EF${tail}1`, kind: 'CAR' }).expect(201);
      const after = await http().get('/api/v1/vehicles/my').set(auth(resA2)).expect(200);
      expect(after.body.data.map((v: any) => v.id)).not.toContain(victim.id);
    });
  });

  describe('the committee register', () => {
    it('lists vehicles with their flat, searchable by plate, flat or make; others are refused', async () => {
      const all = await http().get('/api/v1/vehicles').set(auth(adminA)).expect(200);
      const car = all.body.data.find((v: any) => v.id === car1);
      expect(car).toMatchObject({ flatCode: 'VA-101', plate: `TS09AB${tail}01`, make: 'Maruti Swift' });
      expect(car.flat).toBeUndefined();

      const byPlate = await http().get(`/api/v1/vehicles?search=ab-${tail}01`).set(auth(adminA)).expect(200);
      expect(byPlate.body.data.map((v: any) => v.id)).toContain(car1);
      const byFlat = await http().get('/api/v1/vehicles?search=VA-102').set(auth(adminA)).expect(200);
      expect(byFlat.body.data.every((v: any) => v.flatCode === 'VA-102')).toBe(true);
      const byMake = await http().get('/api/v1/vehicles?search=swift').set(auth(adminA)).expect(200);
      expect(byMake.body.data.map((v: any) => v.id)).toContain(car1);
      const removed = await http().get('/api/v1/vehicles?removed=true').set(auth(adminA)).expect(200);
      expect(removed.body.data.every((v: any) => v.active === false)).toBe(true);
      expect(removed.body.data.length).toBeGreaterThan(0);

      for (const t of [resA1, guardA]) await http().get('/api/v1/vehicles').set(auth(t)).expect(403);
      const other = await http().get('/api/v1/vehicles').set(auth(adminB)).expect(200);
      expect(other.body.data.map((v: any) => v.id)).not.toContain(car1);
    });

    it('removes a record with a reason, which the household sees; the committee of another society cannot', async () => {
      const b = await addVehicle(resA1, { plate: `TS09GH${tail}`, kind: 'CAR' }).expect(201);
      await http().post(`/api/v1/vehicles/${b.body.data.id}/deactivate`).set(auth(adminA)).send({}).expect(400);
      await http().post(`/api/v1/vehicles/${b.body.data.id}/deactivate`).set(auth(resA1)).send({ reason: 'I want to' }).expect(403);
      await http().post(`/api/v1/vehicles/${b.body.data.id}/deactivate`).set(auth(adminB)).send({ reason: 'Not mine to remove' }).expect(404);
      await http().post(`/api/v1/vehicles/${b.body.data.id}/deactivate`).set(auth(adminA)).send({ reason: 'Car was sold' }).expect(200);
      await http().post(`/api/v1/vehicles/${b.body.data.id}/deactivate`).set(auth(adminA)).send({ reason: 'Again' }).expect(404);
      const row = await prisma.vehicle.findUniqueOrThrow({ where: { id: b.body.data.id } });
      expect(row).toMatchObject({ active: false, removedReason: 'Car was sold' });
    });
  });

  describe('parking slots', () => {
    let carSlot: string;
    let bikeSlot: string;
    let visitorSlot: string;

    it('the committee adds slots one at a time, with unique codes', async () => {
      const a = await makeSlot(adminA, { code: `C-${tail}-1`, slotFor: 'CAR', area: 'Basement 1' }).expect(201);
      carSlot = a.body.data.id;
      expect(a.body.data).toMatchObject({ code: `C-${tail}-1`, slotFor: 'CAR', flatCode: null, vehiclePlate: null });
      bikeSlot = (await makeSlot(adminA, { code: `B-${tail}-1`, slotFor: 'TWO_WHEELER' }).expect(201)).body.data.id;
      visitorSlot = (await makeSlot(adminA, { code: `V-${tail}-1`, visitor: true }).expect(201)).body.data.id;
      await makeSlot(adminA, { code: `C-${tail}-1` }).expect(409);
      await makeSlot(resA1, { code: 'Nope' }).expect(403);
      await makeSlot(guardA, { code: 'Nope' }).expect(403);
      await makeSlot(adminB, { code: `C-${tail}-1` }).expect(201); // another society may use the same code
    });

    it('adds a block at once, all or none', async () => {
      const res = await http().post('/api/v1/parking-slots/bulk').set(auth(adminA)).send({ prefix: `P${tail}-`, from: 1, to: 5, pad: 2, slotFor: 'CAR' }).expect(201);
      expect(res.body.data).toEqual({ created: 5, first: `P${tail}-01`, last: `P${tail}-05` });

      const before = await prisma.parkingSlot.count({ where: { societyId: societyA } });
      const clash = await http().post('/api/v1/parking-slots/bulk').set(auth(adminA)).send({ prefix: `P${tail}-`, from: 4, to: 8, pad: 2 }).expect(409);
      expect(clash.body.message).toMatch(/Nothing was created/);
      expect(await prisma.parkingSlot.count({ where: { societyId: societyA } })).toBe(before);

      await http().post('/api/v1/parking-slots/bulk').set(auth(adminA)).send({ prefix: 'X', from: 5, to: 1 }).expect(400);
      await http().post('/api/v1/parking-slots/bulk').set(auth(adminA)).send({ prefix: 'X', from: 1, to: 500 }).expect(400);
      await http().post('/api/v1/parking-slots/bulk').set(auth(resA1)).send({ prefix: 'X', from: 1, to: 2 }).expect(403);
    });

    it('lists slots with a summary, filtered by status or search', async () => {
      const all = await http().get('/api/v1/parking-slots?limit=200').set(auth(adminA)).expect(200);
      expect(all.body.meta.free).toBeGreaterThanOrEqual(7);
      expect(all.body.meta.allocated).toBeGreaterThanOrEqual(0);
      expect(all.body.summary).toBeUndefined();
      const free = await http().get('/api/v1/parking-slots?status=FREE&limit=200').set(auth(adminA)).expect(200);
      expect(free.body.data.every((s: any) => s.flatCode === null && s.visitor === false)).toBe(true);
      expect(free.body.data.map((s: any) => s.id)).not.toContain(visitorSlot);
      const visitor = await http().get('/api/v1/parking-slots?status=VISITOR').set(auth(adminA)).expect(200);
      expect(visitor.body.data.map((s: any) => s.id)).toContain(visitorSlot);
      await http().get('/api/v1/parking-slots?status=NOPE').set(auth(adminA)).expect(400);
      const other = await http().get('/api/v1/parking-slots?limit=200').set(auth(adminB)).expect(200);
      expect(other.body.data.map((s: any) => s.id)).not.toContain(carSlot);
    });

    it('allocates a free slot to a flat, which then sees it; a visitor slot cannot be allocated', async () => {
      const res = await allocate(adminA, carSlot, flatA1).expect(200);
      expect(res.body.data).toMatchObject({ flatCode: 'VA-101', flatId: flatA1 });
      await allocate(adminA, bikeSlot, flatA1).expect(200);
      await allocate(adminA, visitorSlot, flatA1).expect(409);

      const mine = await http().get('/api/v1/parking/my').set(auth(resA1)).expect(200);
      expect(mine.body.data.map((s: any) => s.id).sort()).toEqual([carSlot, bikeSlot].sort());
      const theirs = await http().get('/api/v1/parking/my').set(auth(resA2)).expect(200);
      expect(theirs.body.data).toHaveLength(0);
      await http().get('/api/v1/parking/my').set(auth(guardA)).expect(403);
    });

    it('allocating an allocated slot, a slot in another society, or to another society’s flat is refused', async () => {
      await allocate(adminA, carSlot, flatA2).expect(409);
      await allocate(adminB, carSlot, flatB1).expect(404);
      const free = (await makeSlot(adminA, { code: `F-${tail}-1` }).expect(201)).body.data.id;
      await allocate(adminA, free, flatB1).expect(404);
      await allocate(resA1, free, flatA1).expect(403);
      await allocate(adminA, free, 'not-a-uuid').expect(400);
    });

    it('two committee members allocating the same free slot at once: exactly one wins', async () => {
      const slot = (await makeSlot(adminA, { code: `R-${tail}-1` }).expect(201)).body.data.id;
      const [a, b] = await Promise.all([allocate(adminA, slot, flatA1), allocate(adminA, slot, flatA2)]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const row = await prisma.parkingSlot.findUniqueOrThrow({ where: { id: slot } });
      expect([flatA1, flatA2]).toContain(row.flatId);
      await http().post(`/api/v1/parking-slots/${slot}/release`).set(auth(adminA)).send({}).expect(200);
    });

    it('the household says which vehicle uses a slot: its own, still registered, and one that fits', async () => {
      const ok = await assign(resA1, carSlot, car1).expect(200);
      expect(ok.body.data).toMatchObject({ vehiclePlate: `TS09AB${tail}01`, vehicleKind: 'CAR' });

      const noFit = await assign(resA1, carSlot, bike1).expect(400);
      expect(noFit.body.message).toMatch(/car slot/);
      await assign(resA1, bikeSlot, car1).expect(400); // a car in a two-wheeler slot
      await assign(resA1, bikeSlot, bike1).expect(200);

      const a2Vehicle = (await http().get('/api/v1/vehicles/my').set(auth(resA2)).expect(200)).body.data[0].id;
      await assign(resA1, carSlot, a2Vehicle).expect(404); // not their vehicle
      await assign(resA2, carSlot, a2Vehicle).expect(404); // not their slot
      await assign(resA1, carSlot, 'nope').expect(400);

      const vehicles = await http().get('/api/v1/vehicles/my').set(auth(resA1)).expect(200);
      expect(vehicles.body.data.find((v: any) => v.id === car1).slots.map((s: any) => s.id)).toEqual([carSlot]);
    });

    it('a vehicle sits in one slot: putting it in a second takes it out of the first', async () => {
      const second = (await makeSlot(adminA, { code: `S-${tail}-1`, slotFor: 'CAR' }).expect(201)).body.data.id;
      await allocate(adminA, second, flatA1).expect(200);
      await assign(resA1, second, car1).expect(200);
      expect((await prisma.parkingSlot.findUniqueOrThrow({ where: { id: carSlot } })).vehicleId).toBeNull();
      expect((await prisma.parkingSlot.findUniqueOrThrow({ where: { id: second } })).vehicleId).toBe(car1);
      await assign(resA1, second, null).expect(200);
      expect((await prisma.parkingSlot.findUniqueOrThrow({ where: { id: second } })).vehicleId).toBeNull();
      await http().post(`/api/v1/parking-slots/${second}/release`).set(auth(adminA)).send({}).expect(200);
    });

    it('removing a vehicle takes it out of its slot', async () => {
      const v = (await addVehicle(resA1, { plate: `TS09IJ${tail}`, kind: 'CAR' }).expect(201)).body.data.id;
      await assign(resA1, carSlot, v).expect(200);
      await http().post(`/api/v1/vehicles/${v}/remove`).set(auth(resA1)).send({}).expect(200);
      expect((await prisma.parkingSlot.findUniqueOrThrow({ where: { id: carSlot } })).vehicleId).toBeNull();
    });

    it('a slot in use cannot be deleted; released, it can; and release empties it', async () => {
      await assign(resA1, carSlot, car1).expect(200);
      await http().delete(`/api/v1/parking-slots/${carSlot}`).set(auth(adminA)).expect(409);
      await http().delete(`/api/v1/parking-slots/${carSlot}`).set(auth(adminB)).expect(404);

      const released = await http().post(`/api/v1/parking-slots/${carSlot}/release`).set(auth(adminA)).send({}).expect(200);
      expect(released.body.data).toMatchObject({ flatId: null, flatCode: null, vehicleId: null, vehiclePlate: null });
      await http().post(`/api/v1/parking-slots/${carSlot}/release`).set(auth(adminA)).send({}).expect(409);
      await http().delete(`/api/v1/parking-slots/${carSlot}`).set(auth(adminA)).expect(200);
      await http().delete(`/api/v1/parking-slots/${carSlot}`).set(auth(adminA)).expect(404);
      await http().delete(`/api/v1/parking-slots/${bikeSlot}`).set(auth(resA1)).expect(403);
    });
  });

  describe('at the gate', () => {
    it('finds a vehicle by the last digits, answering with a flat number and slot only', async () => {
      const slot = (await makeSlot(adminA, { code: `G-${tail}-1`, slotFor: 'CAR' }).expect(201)).body.data.id;
      await allocate(adminA, slot, flatA1).expect(200);
      await assign(resA1, slot, car1).expect(200);

      const res = await lookup(guardA, `${tail}01`).expect(200);
      const hit = res.body.data.find((v: any) => v.id === car1);
      expect(hit).toEqual({ id: car1, plate: `TS09AB${tail}01`, kind: 'CAR', make: 'Maruti Swift', colour: 'White', flatCode: 'VA-101', slotCodes: [`G-${tail}-1`] });
      expect(JSON.stringify(res.body)).not.toMatch(/phone|email|firstName|lastName|createdById/);
      const typed = await lookup(guardA, `ts09 ab ${tail}01`).expect(200);
      expect(typed.body.data.map((v: any) => v.id)).toContain(car1);
    });

    it('wants at least three characters, and cannot be used to list everything', async () => {
      await lookup(guardA, 'AB').expect(400);
      await lookup(guardA, '%').expect(400);
      await lookup(guardA, '   ').expect(400);
      await lookup(guardA, '_ _').expect(400);
    });

    it('does not find removed vehicles, other societies’ vehicles, or answer a resident', async () => {
      const removed = await prisma.vehicle.findFirstOrThrow({ where: { societyId: societyA, active: false, plate: { startsWith: 'TS09EF' } } });
      const gone = await lookup(guardA, removed.plate).expect(200);
      expect(gone.body.data.map((v: any) => v.id)).not.toContain(removed.id);

      const b = await lookup(guardB, `${tail}01`).expect(200);
      expect(b.body.data.map((v: any) => v.id)).not.toContain(car1);
      expect(b.body.data.every((v: any) => v.flatCode.startsWith('VB-'))).toBe(true);

      await lookup(resA1, `${tail}01`).expect(403);
      await lookup(adminA, `${tail}01`).expect(200); // the committee may work the gate
    });
  });

  describe('the audit trail', () => {
    it('records who did what, with nothing secret', async () => {
      const rows = await prisma.auditLog.findMany({ where: { societyId: societyA, entityType: { in: ['Vehicle', 'ParkingSlot'] } } });
      const actions = new Set(rows.map((r) => (r.newValues as any)?.action));
      for (const a of ['VEHICLE_ADDED', 'VEHICLE_REMOVED', 'SLOT_CREATED', 'SLOTS_CREATED', 'SLOT_ALLOCATED', 'SLOT_RELEASED', 'SLOT_DELETED']) expect(actions).toContain(a);
    });
  });
});
