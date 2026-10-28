/**
 * Who may call what, and what a request may contain — the two things enforced
 * before the service runs. The roles are read from the real controllers'
 * metadata and judged by the real RolesGuard.
 */

import { BadRequestException, ExecutionContext, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemRole } from '@prisma/client';
import { RolesGuard } from '../common/guards/roles.guard';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { GateController, VisitorInvitationsController, VisitorsController } from './visitors.controller';
import { CreateInvitationDto, OverrideDto, ScanCodeDto, UpdateVisitorPolicyDto, WalkInDto } from './dto/visitor.dto';

const reflector = new Reflector();
const guard = new RolesGuard(reflector);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ControllerClass = { new (...args: any[]): unknown; prototype: object };

function ctx(controller: ControllerClass, handler: string, role: SystemRole | undefined, isPlatformAdmin = false): ExecutionContext {
  return {
    getHandler: () => (controller.prototype as Record<string, () => unknown>)[handler],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user: { currentRole: role, isPlatformAdmin } }) }),
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

describe('the gate routes', () => {
  const gateHandlers = ['flats', 'walkIn', 'scan', 'list', 'checkIn', 'checkOut'];

  it.each(gateHandlers)('%s: guards and the committee may use it', (h) => {
    expect(allowed(ctx(GateController, h, SystemRole.SECURITY_GUARD))).toBe(true);
    expect(allowed(ctx(GateController, h, SystemRole.SOCIETY_ADMIN))).toBe(true);
    expect(allowed(ctx(GateController, h, SystemRole.COMMITTEE_MEMBER))).toBe(true);
  });

  it.each(gateHandlers)('%s: residents, accountants and staff may not', (h) => {
    for (const role of [SystemRole.RESIDENT, SystemRole.SOCIETY_ACCOUNTANT, SystemRole.SOCIETY_STAFF]) {
      expect(allowed(ctx(GateController, h, role))).toBe(false);
    }
  });

  it('a request with no role at all is refused', () => {
    expect(allowed(ctx(GateController, 'scan', undefined))).toBe(false);
  });
});

describe('what a guard cannot do', () => {
  const fromGuard = (controller: ControllerClass, handler: string) => allowed(ctx(controller, handler, SystemRole.SECURITY_GUARD));

  it.each(['log', 'override', 'updatePolicy'])('VisitorsController.%s is committee only — not the guard', (h) => {
    expect(fromGuard(VisitorsController, h)).toBe(false);
  });

  it.each(['log', 'override', 'updatePolicy'])('VisitorsController.%s is refused to residents too', (h) => {
    expect(allowed(ctx(VisitorsController, h, SystemRole.RESIDENT))).toBe(false);
  });

  it.each(['log', 'override', 'updatePolicy'])('VisitorsController.%s works for admin and committee', (h) => {
    expect(allowed(ctx(VisitorsController, h, SystemRole.SOCIETY_ADMIN))).toBe(true);
    expect(allowed(ctx(VisitorsController, h, SystemRole.COMMITTEE_MEMBER))).toBe(true);
  });

  it('the resident routes carry no role gate — the service requires a flat, which a guard does not have', () => {
    for (const h of ['mine', 'approve', 'reject', 'policy']) {
      const handler = (VisitorsController.prototype as any)[h];
      expect(reflector.getAllAndOverride(ROLES_KEY, [handler, VisitorsController])).toBeUndefined();
    }
    for (const h of ['create', 'mine', 'revoke']) {
      const handler = (VisitorInvitationsController.prototype as any)[h];
      expect(reflector.getAllAndOverride(ROLES_KEY, [handler, VisitorInvitationsController])).toBeUndefined();
    }
  });

  it('every role other than the ones named is shut out of the gate', () => {
    const inGate = ALL_ROLES.filter((r) => allowed(ctx(GateController, 'scan', r)));
    expect(inGate.sort()).toEqual([SystemRole.COMMITTEE_MEMBER, SystemRole.SECURITY_GUARD, SystemRole.SOCIETY_ADMIN].sort());
  });
});

describe('request validation (the global pipe)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } });
  const run = (value: unknown, metatype: any) => pipe.transform(value, { type: 'body', metatype });
  const FLAT = '11111111-1111-4111-8111-111111111111';
  const future = new Date(Date.now() + 3_600_000).toISOString();

  describe('CreateInvitationDto', () => {
    it('accepts a normal invitation and trims the name', async () => {
      const out: any = await run({ visitorName: '  Ravi Kumar ', validUntil: future, maxUses: 2, visitorType: 'GUEST' }, CreateInvitationDto);
      expect(out.visitorName).toBe('Ravi Kumar');
    });

    // The flat, society and creator come from the sign-in. A body may not try to choose them.
    it.each([
      ['flatId', FLAT],
      ['societyId', 'soc-2'],
      ['createdById', 'someone-else'],
      ['usedCount', 0],
      ['status', 'ACTIVE'],
      ['codeHash', 'abc'],
      ['code', 'AAAAAAAA'],
    ])('refuses a body that tries to set %s', async (field, value) => {
      await expect(run({ visitorName: 'Ravi', validUntil: future, [field]: value }, CreateInvitationDto)).rejects.toThrow(BadRequestException);
    });

    it.each([
      { why: 'a one-letter name', body: { visitorName: 'R', validUntil: future } },
      { why: 'no end time', body: { visitorName: 'Ravi' } },
      { why: 'an end that is not a date', body: { visitorName: 'Ravi', validUntil: 'tomorrow' } },
      { why: 'zero uses', body: { visitorName: 'Ravi', validUntil: future, maxUses: 0 } },
      { why: 'too many uses', body: { visitorName: 'Ravi', validUntil: future, maxUses: 51 } },
      { why: 'an unknown type', body: { visitorName: 'Ravi', validUntil: future, visitorType: 'VIP' } },
      { why: 'a phone that is not a number', body: { visitorName: 'Ravi', validUntil: future, visitorPhone: 'call me' } },
    ])('refuses ', async ({ body }) => {
      await expect(run(body, CreateInvitationDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('WalkInDto', () => {
    const ok = { flatId: FLAT, visitorName: 'Cab driver', clientRequestId: 'abc-123' };

    it('accepts a normal walk-in', async () => {
      await expect(run({ ...ok, vehicleNumber: 'TS09 AB 1234', visitorPhone: '+919812345678', visitorType: 'CAB' }, WalkInDto)).resolves.toBeDefined();
    });

    it('requires clientRequestId, which is what makes a retry safe', async () => {
      const without: Record<string, unknown> = { ...ok };
      delete without.clientRequestId;
      await expect(run(without, WalkInDto)).rejects.toThrow(BadRequestException);
    });

    it.each([
      { why: 'a flat code instead of an id', over: { flatId: 'A-403' } },
      { why: 'a nonsense vehicle number', over: { vehicleNumber: '!!' } },
      { why: 'an unknown type', over: { visitorType: 'ROYALTY' } },
      { why: 'a pre-set status', over: { status: 'APPROVED' } },
      { why: 'a pre-set decision', over: { decisionMethod: 'POLICY' } },
      { why: 'a society', over: { societyId: 'soc-2' } },
      { why: 'a forged guard', over: { registeredById: 'x' } },
      { why: 'an over-long request id', over: { clientRequestId: 'x'.repeat(65) } },
    ])('refuses ', async ({ over }) => {
      await expect(run({ ...ok, ...over }, WalkInDto)).rejects.toThrow(BadRequestException);
    });
  });

  describe('ScanCodeDto', () => {
    it('accepts a code and a request id', async () => {
      await expect(run({ code: 'K7QX-92MD', clientRequestId: 'r1' }, ScanCodeDto)).resolves.toBeDefined();
    });
    it.each([[{ code: 'abc', clientRequestId: 'r' }], [{ code: 'K7QX-92MD' }], [{ code: 'K7QX-92MD', clientRequestId: 'r', societyId: 'x' }]])(
      'refuses %j',
      async (body) => {
        await expect(run(body, ScanCodeDto)).rejects.toThrow(BadRequestException);
      },
    );
  });

  describe('OverrideDto and policy', () => {
    it('requires a reason for an override', async () => {
      await expect(run({ action: 'APPROVE' }, OverrideDto)).rejects.toThrow(BadRequestException);
      await expect(run({ action: 'APPROVE', reason: 'ok' }, OverrideDto)).rejects.toThrow(BadRequestException);
      await expect(run({ action: 'APPROVE', reason: 'Committee arranged the plumber' }, OverrideDto)).resolves.toBeDefined();
    });

    it('allows only APPROVE or REJECT', async () => {
      await expect(run({ action: 'DELETE', reason: 'because' }, OverrideDto)).rejects.toThrow(BadRequestException);
    });

    it.each([[{ maxInviteDays: 0 }], [{ maxInviteDays: 31 }], [{ maxUsesPerInvite: 51 }], [{ approvalWindowMinutes: 4 }], [{ walkInApproval: 'SOMETIMES' }], [{ somethingElse: 1 }]])(
      'refuses the policy %j',
      async (body) => {
        await expect(run(body, UpdateVisitorPolicyDto)).rejects.toThrow(BadRequestException);
      },
    );

    it('accepts a valid change', async () => {
      await expect(run({ walkInApproval: 'NOT_REQUIRED', maxInviteDays: 14 }, UpdateVisitorPolicyDto)).resolves.toBeDefined();
    });
  });
});
