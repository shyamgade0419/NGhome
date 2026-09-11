/**
 * TenantGuard is the one place every society-scoped request re-checks its
 * membership against the database — this is what stops a still-valid JWT
 * from continuing to authorize with data that was only true when the token
 * was issued. An access token lives for JWT_ACCESS_EXPIRATION (minutes)
 * and a refresh token for JWT_REFRESH_EXPIRATION (days); without this, a
 * moved flat or a changed role would silently keep working for however
 * much of that window was left.
 */

import { ForbiddenException, UnauthorizedException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SystemRole } from '@prisma/client';
import { TenantGuard } from './tenant.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';

const USER_ID = 'user-1';
const MEMBERSHIP_ID = 'membership-1';
const SOCIETY_ID = 'society-a';

function makeContext(user: Partial<AuthenticatedUser> | null, opts: { requiresPlatformAdmin?: boolean } = {}) {
  const request: any = { user };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;

  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(opts.requiresPlatformAdmin ?? false),
  } as unknown as Reflector;

  return { context, reflector, request };
}

function makeGuard(membershipFindFirstResult: unknown, reflector?: Reflector) {
  const prisma = {
    societyMembership: { findFirst: jest.fn().mockResolvedValue(membershipFindFirstResult) },
  } as unknown as PrismaService;
  const guard = new TenantGuard(reflector ?? ({ getAllAndOverride: jest.fn().mockReturnValue(false) } as unknown as Reflector), prisma);
  return { guard, prisma };
}

describe('TenantGuard — flatId is re-read from the database every request', () => {
  it("a resident moved from flat 101 to flat 202 loses the old token's authorization for flat 101", async () => {
    // The token was issued while the resident was in flat 101 — a stale
    // snapshot, exactly like a real still-valid access token would carry.
    const { context, request } = makeContext({
      id: USER_ID,
      societyId: SOCIETY_ID,
      membershipId: MEMBERSHIP_ID,
      flatId: 'flat-101',
      currentRole: SystemRole.RESIDENT,
    });
    // The membership itself now points at flat-202 — an admin moved them.
    const { guard } = makeGuard({
      id: MEMBERSHIP_ID,
      userId: USER_ID,
      societyId: SOCIETY_ID,
      flatId: 'flat-202',
      role: SystemRole.RESIDENT,
      status: 'ACTIVE',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    // request.user is what every @CurrentUser()/@SocietyId() consumer reads
    // downstream — this is the actual authorization-relevant assertion.
    expect(request.user.flatId).toBe('flat-202');
    expect(request.user.flatId).not.toBe('flat-101');
  });
});

describe('TenantGuard — role is re-read from the database every request', () => {
  it('an admin downgraded to resident does not keep admin privileges on their existing token', async () => {
    const { context, request } = makeContext({
      id: USER_ID,
      societyId: SOCIETY_ID,
      membershipId: MEMBERSHIP_ID,
      currentRole: SystemRole.SOCIETY_ADMIN, // stale — this is what the JWT still says
    });
    const { guard } = makeGuard({
      id: MEMBERSHIP_ID,
      userId: USER_ID,
      societyId: SOCIETY_ID,
      flatId: null,
      role: SystemRole.RESIDENT, // what the admin actually changed it to
      status: 'ACTIVE',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user.currentRole).toBe(SystemRole.RESIDENT);
    expect(request.user.currentRole).not.toBe(SystemRole.SOCIETY_ADMIN);
  });

  it('an upgraded role is picked up immediately too — this is a freshness fix, not just a downgrade check', async () => {
    const { context, request } = makeContext({
      id: USER_ID,
      societyId: SOCIETY_ID,
      membershipId: MEMBERSHIP_ID,
      currentRole: SystemRole.RESIDENT,
    });
    const { guard } = makeGuard({
      id: MEMBERSHIP_ID,
      userId: USER_ID,
      societyId: SOCIETY_ID,
      flatId: null,
      role: SystemRole.SOCIETY_ADMIN,
      status: 'ACTIVE',
    });

    await guard.canActivate(context);
    expect(request.user.currentRole).toBe(SystemRole.SOCIETY_ADMIN);
  });
});

describe('TenantGuard — a deactivated membership loses access immediately', () => {
  it('refuses the request once the membership is no longer ACTIVE, even with a still-valid token', async () => {
    const { context } = makeContext({
      id: USER_ID,
      societyId: SOCIETY_ID,
      membershipId: MEMBERSHIP_ID,
      flatId: 'flat-101',
      currentRole: SystemRole.RESIDENT,
    });
    // The WHERE clause itself requires status: 'ACTIVE' — an inactive
    // membership simply isn't found, matching what a real query returns.
    const { guard, prisma } = makeGuard(null);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    expect(prisma.societyMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: MEMBERSHIP_ID, userId: USER_ID, status: 'ACTIVE' }),
      }),
    );
  });
});

describe('TenantGuard — leaving a society and joining another', () => {
  it("the old society's membership being inactive refuses the old token outright", async () => {
    // Leaving society A deactivates that specific membership row; the token
    // still names it, but it no longer resolves.
    const { context } = makeContext({
      id: USER_ID,
      societyId: SOCIETY_ID,
      membershipId: MEMBERSHIP_ID,
      currentRole: SystemRole.RESIDENT,
    });
    const { guard } = makeGuard(null);
    await expect(guard.canActivate(context)).rejects.toThrow('Membership is no longer active');
  });
});

describe('TenantGuard — unchanged behaviour', () => {
  it('still requires an authenticated user', async () => {
    const { context } = makeContext(null);
    const { guard } = makeGuard(null);
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('still requires a societyId on the token for non-platform-admin routes', async () => {
    const { context } = makeContext({ id: USER_ID, societyId: undefined });
    const { guard } = makeGuard(null);
    await expect(guard.canActivate(context)).rejects.toThrow('No active society context');
  });

  it('platform-admin routes bypass the membership check entirely', async () => {
    const { context, reflector } = makeContext(
      { id: USER_ID, isPlatformAdmin: true, societyId: undefined },
      { requiresPlatformAdmin: true },
    );
    const { guard, prisma } = makeGuard(null, reflector);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prisma.societyMembership.findFirst).not.toHaveBeenCalled();
  });

  it('a non-platform-admin is refused on a platform-admin route', async () => {
    const { context, reflector } = makeContext(
      { id: USER_ID, isPlatformAdmin: false },
      { requiresPlatformAdmin: true },
    );
    const { guard } = makeGuard(null, reflector);
    await expect(guard.canActivate(context)).rejects.toThrow('Platform admin access required');
  });

  it('scopes the membership lookup to the userId on the token — never trusts membershipId alone', async () => {
    const { context } = makeContext({
      id: USER_ID,
      societyId: SOCIETY_ID,
      membershipId: MEMBERSHIP_ID,
    });
    const { guard, prisma } = makeGuard({
      id: MEMBERSHIP_ID,
      userId: USER_ID,
      societyId: SOCIETY_ID,
      flatId: null,
      role: SystemRole.RESIDENT,
      status: 'ACTIVE',
    });
    await guard.canActivate(context);
    expect(prisma.societyMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ userId: USER_ID, societyId: SOCIETY_ID }) }),
    );
  });
});
