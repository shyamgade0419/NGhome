/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Who may call which vehicle and parking route, and what a request may contain: the two things
 * enforced before the service runs. Roles are read from the real controllers' metadata and judged
 * by the real RolesGuard.
 */

import { BadRequestException, ExecutionContext, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemRole } from '@prisma/client';
import { RolesGuard } from '../common/guards/roles.guard';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { GateVehiclesController, ParkingController, ParkingSlotsController, VehiclesController } from './vehicles.controller';
import { AddVehicleDto, AllocateSlotDto, AssignVehicleDto, BulkSlotsDto, CommitteeRemoveVehicleDto, CreateSlotDto } from './dto/vehicle.dto';

const reflector = new Reflector();
const guard = new RolesGuard(reflector);

type ControllerClass = { new (...args: any[]): unknown; prototype: object };

function ctx(controller: ControllerClass, handler: string, role: SystemRole | undefined): ExecutionContext {
  return {
    getHandler: () => (controller.prototype as Record<string, () => unknown>)[handler],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user: { currentRole: role, isPlatformAdmin: false } }) }),
  } as unknown as ExecutionContext;
}

const allowed = (c: ExecutionContext) => {
  try {
    return guard.canActivate(c);
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
};

const ALL_ROLES = [SystemRole.RESIDENT, SystemRole.SECURITY_GUARD, SystemRole.SOCIETY_ADMIN, SystemRole.COMMITTEE_MEMBER, SystemRole.SOCIETY_ACCOUNTANT, SystemRole.SOCIETY_STAFF];
const rolesThatPass = (c: ControllerClass, h: string) => ALL_ROLES.filter((r) => allowed(ctx(c, h, r))).sort();
const GATE_ROLES = [SystemRole.COMMITTEE_MEMBER, SystemRole.SECURITY_GUARD, SystemRole.SOCIETY_ADMIN].sort();
const COMMITTEE_ROLES = [SystemRole.COMMITTEE_MEMBER, SystemRole.SOCIETY_ADMIN].sort();

describe('who may call what', () => {
  it('the gate lookup is for guards and the committee only', () => {
    expect(rolesThatPass(GateVehiclesController, 'lookup')).toEqual(GATE_ROLES);
    expect(allowed(ctx(GateVehiclesController, 'lookup', undefined))).toBe(false);
  });

  it.each(['register', 'deactivate'])('VehiclesController.%s is committee only, not even the guard', (h) => {
    expect(rolesThatPass(VehiclesController, h)).toEqual(COMMITTEE_ROLES);
  });

  it.each(['list', 'create', 'bulk', 'remove', 'allocate', 'release'])('ParkingSlotsController.%s is committee only', (h) => {
    expect(rolesThatPass(ParkingSlotsController, h)).toEqual(COMMITTEE_ROLES);
  });

  it('the household routes carry no role gate: the service requires a flat, which a guard is refused', () => {
    for (const h of ['add', 'mine', 'remove']) {
      expect(reflector.getAllAndOverride(ROLES_KEY, [(VehiclesController.prototype as any)[h], VehiclesController])).toBeUndefined();
    }
    for (const h of ['mine', 'assign']) {
      expect(reflector.getAllAndOverride(ROLES_KEY, [(ParkingController.prototype as any)[h], ParkingController])).toBeUndefined();
    }
  });
});

describe('request validation (the global pipe)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  const run = (value: unknown, metatype: any) => pipe.transform(value, { type: 'body', metatype });
  const ID = '11111111-1111-4111-8111-111111111111';

  describe('AddVehicleDto', () => {
    it('accepts a normal vehicle', async () => {
      await expect(run({ plate: ' TS09 AB 1234 ', kind: 'CAR', make: 'Maruti Swift', colour: 'White' }, AddVehicleDto)).resolves.toBeDefined();
    });

    it.each([
      ['flatId', ID],
      ['societyId', 'soc-2'],
      ['active', true],
      ['createdById', 'x'],
    ])('refuses a body that tries to set %s', async (field, value) => {
      await expect(run({ plate: 'TS09AB1234', kind: 'CAR', [field]: value }, AddVehicleDto)).rejects.toThrow(BadRequestException);
    });

    it.each([
      { why: 'no plate', body: { kind: 'CAR' } },
      { why: 'a plate that is too short', body: { plate: 'AB1', kind: 'CAR' } },
      { why: 'a plate with odd characters', body: { plate: 'TS09/AB;1234', kind: 'CAR' } },
      { why: 'no kind', body: { plate: 'TS09AB1234' } },
      { why: 'an unknown kind', body: { plate: 'TS09AB1234', kind: 'TRUCK' } },
      { why: 'a very long make', body: { plate: 'TS09AB1234', kind: 'CAR', make: 'x'.repeat(61) } },
    ])('refuses $why', async ({ body }) => {
      await expect(run(body, AddVehicleDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('slots', () => {
    it('accepts a slot and a block', async () => {
      await expect(run({ code: 'B1-12', slotFor: 'CAR', area: 'Basement 1' }, CreateSlotDto)).resolves.toBeDefined();
      await expect(run({ prefix: 'B1-', from: 1, to: 40, pad: 2, slotFor: 'TWO_WHEELER' }, BulkSlotsDto)).resolves.toBeDefined();
    });

    it.each([
      { why: 'no code', body: {} },
      { why: 'a code over 20 characters', body: { code: 'x'.repeat(21) } },
      { why: 'an unknown slot type', body: { code: 'A1', slotFor: 'TRUCK' } },
      { why: 'a pre-set flat', body: { code: 'A1', flatId: ID } },
    ])('refuses a slot with $why', async ({ body }) => {
      await expect(run(body, CreateSlotDto)).rejects.toThrow(BadRequestException);
    });

    it.each([
      { why: 'no range', body: { prefix: 'A' } },
      { why: 'a fractional number', body: { from: 1.5, to: 3 } },
      { why: 'a number out of range', body: { from: 0, to: 10000 } },
      { why: 'a huge pad', body: { from: 1, to: 3, pad: 9 } },
    ])('refuses a block with $why', async ({ body }) => {
      await expect(run(body, BulkSlotsDto)).rejects.toThrow(BadRequestException);
    });

    it('an allocation needs a flat id, and nothing else', async () => {
      await expect(run({}, AllocateSlotDto)).rejects.toThrow(BadRequestException);
      await expect(run({ flatId: 'A-101' }, AllocateSlotDto)).rejects.toThrow(BadRequestException);
      await expect(run({ flatId: ID, vehicleId: ID }, AllocateSlotDto)).rejects.toThrow(BadRequestException);
      await expect(run({ flatId: ID }, AllocateSlotDto)).resolves.toBeDefined();
    });
  });

  it('assigning a vehicle takes an id or null to clear', async () => {
    await expect(run({ vehicleId: ID }, AssignVehicleDto)).resolves.toBeDefined();
    await expect(run({ vehicleId: null }, AssignVehicleDto)).resolves.toBeDefined();
    await expect(run({}, AssignVehicleDto)).resolves.toBeDefined();
    await expect(run({ vehicleId: 'not-an-id' }, AssignVehicleDto)).rejects.toThrow(BadRequestException);
  });

  it('a committee removal needs a real reason', async () => {
    await expect(run({}, CommitteeRemoveVehicleDto)).rejects.toThrow(BadRequestException);
    await expect(run({ reason: 'ok' }, CommitteeRemoveVehicleDto)).rejects.toThrow(BadRequestException);
    await expect(run({ reason: 'Car was sold' }, CommitteeRemoveVehicleDto)).resolves.toBeDefined();
  });
});
