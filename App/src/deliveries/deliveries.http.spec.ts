/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Who may call which delivery route, and what a request may contain: the two things enforced
 * before the service runs. Roles are read from the real controllers' metadata and judged by the
 * real RolesGuard.
 */

import { BadRequestException, ExecutionContext, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemRole } from '@prisma/client';
import { RolesGuard } from '../common/guards/roles.guard';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { DeliveryExpectationsController, GateDeliveriesController, ParcelsController } from './deliveries.controller';
import { CreateExpectationDto, HandOverParcelDto, ReceiveParcelDto } from './dto/delivery.dto';

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

describe('the gate delivery routes', () => {
  const handlers = ['expected', 'receive', 'list', 'handOver', 'returnToCourier'];

  it.each(handlers)('%s: guards and the committee may use it', (h) => {
    for (const role of [SystemRole.SECURITY_GUARD, SystemRole.SOCIETY_ADMIN, SystemRole.COMMITTEE_MEMBER]) {
      expect(allowed(ctx(GateDeliveriesController, h, role))).toBe(true);
    }
  });

  it.each(handlers)('%s: residents, accountants, staff and no role are shut out', (h) => {
    for (const role of [SystemRole.RESIDENT, SystemRole.SOCIETY_ACCOUNTANT, SystemRole.SOCIETY_STAFF, undefined]) {
      expect(allowed(ctx(GateDeliveriesController, h, role))).toBe(false);
    }
  });

  it('exactly the named roles get through', () => {
    const inGate = ALL_ROLES.filter((r) => allowed(ctx(GateDeliveriesController, 'receive', r)));
    expect(inGate.sort()).toEqual([SystemRole.COMMITTEE_MEMBER, SystemRole.SECURITY_GUARD, SystemRole.SOCIETY_ADMIN].sort());
  });
});

describe('the parcel log', () => {
  it('is committee only: not guards, not residents', () => {
    expect(allowed(ctx(ParcelsController, 'log', SystemRole.SECURITY_GUARD))).toBe(false);
    expect(allowed(ctx(ParcelsController, 'log', SystemRole.RESIDENT))).toBe(false);
    expect(allowed(ctx(ParcelsController, 'log', SystemRole.SOCIETY_ADMIN))).toBe(true);
    expect(allowed(ctx(ParcelsController, 'log', SystemRole.COMMITTEE_MEMBER))).toBe(true);
  });

  it('the household routes carry no role gate: the service requires a flat, which a guard is refused', () => {
    expect(reflector.getAllAndOverride(ROLES_KEY, [(ParcelsController.prototype as any).mine, ParcelsController])).toBeUndefined();
    for (const h of ['create', 'mine', 'cancel']) {
      expect(reflector.getAllAndOverride(ROLES_KEY, [(DeliveryExpectationsController.prototype as any)[h], DeliveryExpectationsController])).toBeUndefined();
    }
  });
});

describe('request validation (the global pipe)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  const run = (value: unknown, metatype: any) => pipe.transform(value, { type: 'body', metatype });
  const FLAT = '11111111-1111-4111-8111-111111111111';

  describe('CreateExpectationDto', () => {
    it('accepts a normal instruction and trims the company', async () => {
      const out: any = await run({ company: '  Amazon ', instruction: 'LEAVE_AT_GATE', note: 'Back door is locked' }, CreateExpectationDto);
      expect(out.company).toBe('Amazon');
    });

    it.each([
      ['flatId', FLAT],
      ['societyId', 'soc-2'],
      ['createdById', 'someone-else'],
      ['usedCount', 0],
      ['status', 'ACTIVE'],
      ['validFrom', new Date().toISOString()],
    ])('refuses a body that tries to set %s', async (field, value) => {
      await expect(run({ company: 'Amazon', instruction: 'ALLOW_ENTRY', [field]: value }, CreateExpectationDto)).rejects.toThrow(BadRequestException);
    });

    it.each([
      { why: 'a one-letter company', body: { company: 'A', instruction: 'ALLOW_ENTRY' } },
      { why: 'no instruction', body: { company: 'Amazon' } },
      { why: 'an unknown instruction', body: { company: 'Amazon', instruction: 'ALWAYS' } },
      { why: 'an end that is not a date', body: { company: 'Amazon', instruction: 'ALLOW_ENTRY', validUntil: 'tonight' } },
      { why: 'zero uses', body: { company: 'Amazon', instruction: 'ALLOW_ENTRY', maxUses: 0 } },
      { why: 'too many uses', body: { company: 'Amazon', instruction: 'ALLOW_ENTRY', maxUses: 11 } },
    ])('refuses $why', async ({ body }) => {
      await expect(run(body, CreateExpectationDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('ReceiveParcelDto', () => {
    const ok = { flatId: FLAT, courier: 'Amazon', clientRequestId: 'abc-123' };

    it('accepts a normal parcel', async () => {
      await expect(run({ ...ok, recipientName: 'Asha', note: 'Large box' }, ReceiveParcelDto)).resolves.toBeDefined();
    });

    it('requires clientRequestId, which is what makes a retry safe', async () => {
      const without: Record<string, unknown> = { ...ok };
      delete without.clientRequestId;
      await expect(run(without, ReceiveParcelDto)).rejects.toThrow(BadRequestException);
    });

    it.each([
      { why: 'a flat code instead of an id', over: { flatId: 'A-403' } },
      { why: 'a one-letter courier', over: { courier: 'A' } },
      { why: 'a pre-set status', over: { status: 'COLLECTED' } },
      { why: 'a society', over: { societyId: 'soc-2' } },
      { why: 'a forged guard', over: { receivedById: 'x' } },
      { why: 'an over-long request id', over: { clientRequestId: 'x'.repeat(65) } },
    ])('refuses $why', async ({ over }) => {
      await expect(run({ ...ok, ...over }, ReceiveParcelDto)).rejects.toThrow(BadRequestException);
    });
  });

  it('a hand-over takes only a name', async () => {
    await expect(run({ collectedByName: 'Asha' }, HandOverParcelDto)).resolves.toBeDefined();
    await expect(run({}, HandOverParcelDto)).resolves.toBeDefined();
    await expect(run({ status: 'RETURNED' }, HandOverParcelDto)).rejects.toThrow(BadRequestException);
  });
});
