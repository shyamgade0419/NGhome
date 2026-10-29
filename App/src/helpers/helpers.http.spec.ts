/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Who may call which household-help route, and what a request may contain: the two things
 * enforced before the service runs. Roles are read from the real controllers' metadata and
 * judged by the real RolesGuard.
 */

import { BadRequestException, ExecutionContext, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemRole } from '@prisma/client';
import { RolesGuard } from '../common/guards/roles.guard';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { GateHelpersController, HelperVisitsController, HelpersController } from './helpers.controller';
import { AddHelperDto, HelperCheckInDto, HelperCodeDto, SuspendHelperDto } from './dto/helper.dto';

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

describe('the gate helper routes', () => {
  it.each(['helpers', 'visits', 'scan', 'checkIn', 'checkOut'])('%s: exactly guards and the committee get through', (h) => {
    expect(rolesThatPass(GateHelpersController, h)).toEqual(GATE_ROLES);
    expect(allowed(ctx(GateHelpersController, h, undefined))).toBe(false);
  });
});

describe('the committee routes', () => {
  it.each(['register', 'verify', 'suspend', 'reinstate'])('HelpersController.%s is committee only, not even the guard', (h) => {
    expect(rolesThatPass(HelpersController, h)).toEqual(COMMITTEE_ROLES);
  });

  it('the attendance log is committee only', () => {
    expect(rolesThatPass(HelperVisitsController, 'log')).toEqual(COMMITTEE_ROLES);
  });

  it('the household routes carry no role gate: the service requires a flat, which a guard is refused', () => {
    for (const h of ['add', 'mine', 'remove', 'newCode', 'visits']) {
      expect(reflector.getAllAndOverride(ROLES_KEY, [(HelpersController.prototype as any)[h], HelpersController])).toBeUndefined();
    }
  });
});

describe('request validation (the global pipe)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  const run = (value: unknown, metatype: any) => pipe.transform(value, { type: 'body', metatype });

  describe('AddHelperDto', () => {
    it('accepts a normal helper and trims the name', async () => {
      const out: any = await run({ name: '  Lakshmi ', role: 'MAID', phone: '+91 98765 43210' }, AddHelperDto);
      expect(out.name).toBe('Lakshmi');
    });

    it('does not need a phone', async () => {
      await expect(run({ name: 'Lakshmi', role: 'COOK' }, AddHelperDto)).resolves.toBeDefined();
    });

    it.each([
      ['flatId', '11111111-1111-4111-8111-111111111111'],
      ['societyId', 'soc-2'],
      ['status', 'ACTIVE'],
      ['codeHash', 'abc'],
      ['verifiedAt', new Date().toISOString()],
      ['createdById', 'x'],
    ])('refuses a body that tries to set %s', async (field, value) => {
      await expect(run({ name: 'Lakshmi', role: 'MAID', [field]: value }, AddHelperDto)).rejects.toThrow(BadRequestException);
    });

    it.each([
      { why: 'a one-letter name', body: { name: 'L', role: 'MAID' } },
      { why: 'no role', body: { name: 'Lakshmi' } },
      { why: 'an unknown role', body: { name: 'Lakshmi', role: 'BOSS' } },
      { why: 'a phone that is not a number', body: { name: 'Lakshmi', role: 'MAID', phone: 'call me' } },
      { why: 'a too-short phone', body: { name: 'Lakshmi', role: 'MAID', phone: '12345' } },
    ])('refuses $why', async ({ body }) => {
      await expect(run(body, AddHelperDto)).rejects.toThrow(BadRequestException);
    });
  });

  it('a check-in and a code both need a request id, which is what makes a retry safe', async () => {
    await expect(run({}, HelperCheckInDto)).rejects.toThrow(BadRequestException);
    await expect(run({ clientRequestId: 'abc' }, HelperCheckInDto)).resolves.toBeDefined();
    await expect(run({ code: 'K7QX-92MD' }, HelperCodeDto)).rejects.toThrow(BadRequestException);
    await expect(run({ code: 'abc', clientRequestId: 'r' }, HelperCodeDto)).rejects.toThrow(BadRequestException);
    await expect(run({ code: 'K7QX-92MD', clientRequestId: 'r' }, HelperCodeDto)).resolves.toBeDefined();
    await expect(run({ clientRequestId: 'x'.repeat(65) }, HelperCheckInDto)).rejects.toThrow(BadRequestException);
  });

  it('a suspension needs a real reason', async () => {
    await expect(run({}, SuspendHelperDto)).rejects.toThrow(BadRequestException);
    await expect(run({ reason: 'ok' }, SuspendHelperDto)).rejects.toThrow(BadRequestException);
    await expect(run({ reason: 'Seen taking things from a flat' }, SuspendHelperDto)).resolves.toBeDefined();
  });
});
