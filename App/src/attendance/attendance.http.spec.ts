/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Who may call which attendance route, and what a request may contain: the two things enforced
 * before the service runs. Roles are read from the real controllers' metadata and judged by the
 * real RolesGuard.
 */

import { BadRequestException, ExecutionContext, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemRole } from '@prisma/client';
import { RolesGuard } from '../common/guards/roles.guard';
import { GateStaffController, StaffAttendanceController, StaffRosterController, StaffShiftsController } from './attendance.controller';
import { AssignRosterDto, ClearRosterDto, CreateShiftDto, MarkAttendanceDto, MarkDayDto, UpdateShiftDto } from './dto/attendance.dto';

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
  it.each(['list', 'checkIn', 'checkOut'])('the gate staff route %s is for guards and the committee only', (h) => {
    expect(rolesThatPass(GateStaffController, h)).toEqual(GATE_ROLES);
    expect(allowed(ctx(GateStaffController, h, undefined))).toBe(false);
  });

  it.each([
    [StaffShiftsController, ['list', 'create', 'update']],
    [StaffRosterController, ['roster', 'assign', 'clear']],
    [StaffAttendanceController, ['staff', 'day', 'mark', 'markDay', 'summary', 'employee']],
  ] as const)('%p is committee only: not the guard, not the accountant, not staff, not residents', (controller, handlers) => {
    for (const h of handlers) expect(rolesThatPass(controller as ControllerClass, h)).toEqual(COMMITTEE_ROLES);
  });
});

describe('request validation (the global pipe)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  const run = (value: unknown, metatype: any) => pipe.transform(value, { type: 'body', metatype });
  const ID = '11111111-1111-4111-8111-111111111111';
  const ID2 = '22222222-2222-4222-8222-222222222222';

  describe('shifts', () => {
    it('accepts a shift, including one that runs past midnight', async () => {
      await expect(run({ name: ' Morning ', startTime: '06:00', endTime: '14:00' }, CreateShiftDto)).resolves.toBeDefined();
      await expect(run({ name: 'Night', startTime: '22:00', endTime: '06:00' }, CreateShiftDto)).resolves.toBeDefined();
    });

    it.each([
      { why: 'no name', body: { startTime: '06:00', endTime: '14:00' } },
      { why: 'a one-letter name', body: { name: 'M', startTime: '06:00', endTime: '14:00' } },
      { why: 'a time that is not a time', body: { name: 'Morning', startTime: '6am', endTime: '14:00' } },
      { why: 'hour 24', body: { name: 'Morning', startTime: '24:00', endTime: '14:00' } },
      { why: 'a pre-set society', body: { name: 'Morning', startTime: '06:00', endTime: '14:00', societyId: 'x' } },
      { why: 'a pre-set active flag', body: { name: 'Morning', startTime: '06:00', endTime: '14:00', active: false } },
    ])('refuses a new shift with $why', async ({ body }) => {
      await expect(run(body, CreateShiftDto)).rejects.toThrow(BadRequestException);
    });

    it('an update takes any subset, and nothing else', async () => {
      await expect(run({ active: false }, UpdateShiftDto)).resolves.toBeDefined();
      await expect(run({ startTime: '07:00' }, UpdateShiftDto)).resolves.toBeDefined();
      await expect(run({ societyId: 'x' }, UpdateShiftDto)).rejects.toThrow(BadRequestException);
      await expect(run({ startTime: 'late' }, UpdateShiftDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('AssignRosterDto', () => {
    const ok = { employeeIds: [ID], from: '2026-11-02', to: '2026-11-08', shiftId: ID2, post: 'Main gate' };

    it('accepts a week on a shift, a day off (no shift), and a weekday filter', async () => {
      await expect(run(ok, AssignRosterDto)).resolves.toBeDefined();
      await expect(run({ employeeIds: [ID], from: '2026-11-02', to: '2026-11-08' }, AssignRosterDto)).resolves.toBeDefined();
      await expect(run({ ...ok, weekdays: [1, 2, 3, 4, 5] }, AssignRosterDto)).resolves.toBeDefined();
      await expect(run({ ...ok, shiftId: null }, AssignRosterDto)).resolves.toBeDefined();
    });

    it.each([
      { why: 'no people', over: { employeeIds: [] } },
      { why: 'the same person twice', over: { employeeIds: [ID, ID] } },
      { why: 'more than 50 people', over: { employeeIds: Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`) } },
      { why: 'an id that is not an id', over: { employeeIds: ['nope'] } },
      { why: 'a date that is not a date', over: { from: 'monday' } },
      { why: 'a weekday of 7', over: { weekdays: [7] } },
      { why: 'a repeated weekday', over: { weekdays: [1, 1] } },
      { why: 'a shift that is not an id', over: { shiftId: 'morning' } },
      { why: 'a pre-set society', over: { societyId: 'x' } },
    ])('refuses $why', async ({ over }) => {
      await expect(run({ ...ok, ...over }, AssignRosterDto)).rejects.toThrow(BadRequestException);
    });

    it('clearing needs people and a range', async () => {
      await expect(run({ employeeIds: [ID], from: '2026-11-02', to: '2026-11-08' }, ClearRosterDto)).resolves.toBeDefined();
      await expect(run({ employeeIds: [], from: '2026-11-02', to: '2026-11-08' }, ClearRosterDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('MarkAttendanceDto', () => {
    const ok = { employeeId: ID, date: '2026-10-30', status: 'PRESENT', checkIn: '06:05', checkOut: '14:10' };

    it('accepts a day with times, and without', async () => {
      await expect(run(ok, MarkAttendanceDto)).resolves.toBeDefined();
      await expect(run({ employeeId: ID, date: '2026-10-30', status: 'ABSENT', note: 'No call' }, MarkAttendanceDto)).resolves.toBeDefined();
    });

    it.each([
      { why: 'an unknown status', over: { status: 'SICK' } },
      { why: 'a date that is not a date', over: { date: 'today' } },
      { why: 'a time that is not a time', over: { checkIn: '6:05' } },
      { why: 'a long note', over: { note: 'x'.repeat(201) } },
      { why: 'a pre-set marker', over: { markedById: 'x' } },
      { why: 'a society', over: { societyId: 'x' } },
    ])('refuses $why', async ({ over }) => {
      await expect(run({ ...ok, ...over }, MarkAttendanceDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('MarkDayDto', () => {
    it('accepts a list of people with statuses', async () => {
      await expect(run({ date: '2026-10-30', entries: [{ employeeId: ID, status: 'PRESENT' }, { employeeId: ID2, status: 'LEAVE' }] }, MarkDayDto)).resolves.toBeDefined();
    });

    it.each([
      { why: 'no entries', body: { date: '2026-10-30', entries: [] } },
      { why: 'an entry with no status', body: { date: '2026-10-30', entries: [{ employeeId: ID }] } },
      { why: 'an entry with an unknown status', body: { date: '2026-10-30', entries: [{ employeeId: ID, status: 'SICK' }] } },
      { why: 'an entry carrying extra fields', body: { date: '2026-10-30', entries: [{ employeeId: ID, status: 'PRESENT', checkIn: '06:00' }] } },
      { why: 'more than 200 entries', body: { date: '2026-10-30', entries: Array.from({ length: 201 }, () => ({ employeeId: ID, status: 'PRESENT' })) } },
    ])('refuses $why', async ({ body }) => {
      await expect(run(body, MarkDayDto)).rejects.toThrow(BadRequestException);
    });
  });
});
