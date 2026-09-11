/**
 * DEFECT-1: addToSociety flat validation unit tests.
 * DEFECT-8: Society-scoped user operations.
 * Role-change-created-a-second-membership fix: addToSociety with no flatId
 * means "change this person's role", not "add them to a flat" — it must
 * update whichever active membership they already have in this society
 * rather than upserting a second, flat-less one.
 */

import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { SystemRole } from '@prisma/client';

const SOCIETY_ID = 'society-a';
const OTHER_SOCIETY_ID = 'society-b';
const USER_ID = 'user-1';
const FLAT_ID = 'flat-a-1';
const FLAT_B_ID = 'flat-b-1';

function makePrisma(overrides: {
  societyFindUnique?: unknown;
  userFindUnique?: unknown;
  userFindFirst?: unknown;
  flatFindFirst?: unknown;
  membershipFindMany?: unknown[];
  membershipUpdate?: unknown;
  membershipUpsert?: unknown;
} = {}) {
  const defaults = {
    societyFindUnique: 'societyFindUnique' in overrides ? overrides.societyFindUnique : { id: SOCIETY_ID },
    userFindUnique: 'userFindUnique' in overrides ? overrides.userFindUnique : { id: USER_ID },
    userFindFirst: 'userFindFirst' in overrides ? overrides.userFindFirst : { id: USER_ID, memberships: [] },
    flatFindFirst: 'flatFindFirst' in overrides ? overrides.flatFindFirst : { id: FLAT_ID, societyId: SOCIETY_ID },
    membershipFindMany: overrides.membershipFindMany ?? [],
    membershipUpdate: overrides.membershipUpdate ?? { id: 'membership-1', updated: true },
    membershipUpsert: overrides.membershipUpsert ?? { id: 'membership-1' },
  };

  return {
    society: { findUnique: jest.fn().mockResolvedValue(defaults.societyFindUnique) },
    user: {
      findUnique: jest.fn().mockResolvedValue(defaults.userFindUnique),
      findFirst: jest.fn().mockResolvedValue(defaults.userFindFirst),
    },
    flat: { findFirst: jest.fn().mockResolvedValue(defaults.flatFindFirst) },
    societyMembership: {
      findMany: jest.fn().mockResolvedValue(defaults.membershipFindMany),
      update: jest.fn().mockResolvedValue(defaults.membershipUpdate),
      upsert: jest.fn().mockResolvedValue(defaults.membershipUpsert),
    },
  } as unknown as PrismaService;
}

/**
 * findOne(id, societyId) is how the admin "view resident" screen loads a
 * user — societyId here is always the caller's own (from TenantGuard), so
 * this pins that a user with no active membership in the CALLER's society
 * reads as not-found, not as "here is Society B's user". No production
 * code path was found that lets a client supply societyId directly to this
 * method, but the method itself had no test proving the scoping actually
 * works if that ever changed.
 */
describe('UsersService.findOne — tenant isolation', () => {
  it('finds the user when they hold an active membership in the given society', async () => {
    const prisma = makePrisma({ userFindFirst: { id: USER_ID, memberships: [] } });
    const service = new UsersService(prisma);
    await expect(service.findOne(USER_ID, SOCIETY_ID)).resolves.toEqual({ id: USER_ID, memberships: [] });
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: USER_ID,
          memberships: { some: { societyId: SOCIETY_ID, status: 'ACTIVE' } },
        }),
      }),
    );
  });

  it("refuses a user who belongs only to a different society — Society A cannot read Society B's user", async () => {
    // A real Prisma query scoped by `memberships: { some: { societyId } } }`
    // would return null here; the mock stands in for that database behaviour.
    const prisma = makePrisma({ userFindFirst: null });
    const service = new UsersService(prisma);
    await expect(service.findOne(USER_ID, OTHER_SOCIETY_ID)).rejects.toThrow(NotFoundException);
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          memberships: { some: { societyId: OTHER_SOCIETY_ID, status: 'ACTIVE' } },
        }),
      }),
    );
  });

  it('update() and deactivate() both refuse a cross-society id the same way, before writing anything', async () => {
    const prisma = makePrisma({ userFindFirst: null });
    const service = new UsersService(prisma);
    await expect(service.update(USER_ID, OTHER_SOCIETY_ID, {})).rejects.toThrow(NotFoundException);
    await expect(service.deactivate(USER_ID, OTHER_SOCIETY_ID)).rejects.toThrow(NotFoundException);
  });
});

describe('UsersService — addToSociety flat validation (DEFECT-1)', () => {
  describe('valid combinations', () => {
    it('allows adding user without a flat (role-only membership)', async () => {
      const service = new UsersService(makePrisma());
      await expect(
        service.addToSociety(SOCIETY_ID, USER_ID, undefined, SystemRole.RESIDENT, false),
      ).resolves.toBeDefined();
    });

    it('allows adding user with a flat that belongs to the same society', async () => {
      const service = new UsersService(makePrisma({ flatFindFirst: { id: FLAT_ID, societyId: SOCIETY_ID } }));
      await expect(
        service.addToSociety(SOCIETY_ID, USER_ID, FLAT_ID, SystemRole.RESIDENT, true),
      ).resolves.toBeDefined();
    });
  });

  describe('cross-society flat rejection (DEFECT-1)', () => {
    it('rejects when flatId exists but belongs to another society', async () => {
      // Flat from Society B — findFirst returns null because societyId filter excludes it
      const service = new UsersService(makePrisma({ flatFindFirst: null }));
      await expect(
        service.addToSociety(SOCIETY_ID, USER_ID, FLAT_B_ID, SystemRole.RESIDENT, false),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects when flatId does not exist at all', async () => {
      const service = new UsersService(makePrisma({ flatFindFirst: null }));
      await expect(
        service.addToSociety(SOCIETY_ID, USER_ID, 'nonexistent-flat', SystemRole.RESIDENT, false),
      ).rejects.toThrow('Flat not found in this society');
    });

    it('never calls flat lookup when flatId is undefined', async () => {
      const prisma = makePrisma({ flatFindFirst: null }); // null — would throw if called
      const service = new UsersService(prisma);
      await expect(
        service.addToSociety(SOCIETY_ID, USER_ID, undefined, SystemRole.SOCIETY_ADMIN, true),
      ).resolves.toBeDefined();
      // Flat lookup must NOT have been called
      expect((prisma.flat as any).findFirst).not.toHaveBeenCalled();
    });
  });

  describe('role change with no flatId updates the existing membership in place', () => {
    it('updates the sole existing membership rather than creating a second one', async () => {
      const prisma = makePrisma({
        membershipFindMany: [{ id: 'membership-1', flatId: FLAT_ID }],
      });
      const service = new UsersService(prisma);
      await expect(
        service.addToSociety(SOCIETY_ID, USER_ID, undefined, SystemRole.SOCIETY_ADMIN, false),
      ).resolves.toBeDefined();

      expect((prisma.societyMembership as any).update).toHaveBeenCalledWith({
        where: { id: 'membership-1' },
        data: { role: SystemRole.SOCIETY_ADMIN, isPrimary: false },
      });
      // The resident's real flat membership must never be touched via
      // upsert-on-flatId:'' — that's the bug this replaces.
      expect((prisma.societyMembership as any).upsert).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the person holds more than one flat membership in this society', async () => {
      const prisma = makePrisma({
        membershipFindMany: [
          { id: 'membership-1', flatId: FLAT_ID },
          { id: 'membership-2', flatId: FLAT_B_ID },
        ],
      });
      const service = new UsersService(prisma);
      await expect(
        service.addToSociety(SOCIETY_ID, USER_ID, undefined, SystemRole.SOCIETY_ADMIN, false),
      ).rejects.toThrow(ConflictException);
      expect((prisma.societyMembership as any).update).not.toHaveBeenCalled();
      expect((prisma.societyMembership as any).upsert).not.toHaveBeenCalled();
    });

    it('falls through to create a flat-less membership when the person has none yet', async () => {
      const prisma = makePrisma({ membershipFindMany: [] });
      const service = new UsersService(prisma);
      await expect(
        service.addToSociety(SOCIETY_ID, USER_ID, undefined, SystemRole.SOCIETY_ADMIN, false),
      ).resolves.toBeDefined();
      expect((prisma.societyMembership as any).upsert).toHaveBeenCalled();
    });

    it('an explicit flatId (adding a second flat) skips the role-change branch entirely', async () => {
      const prisma = makePrisma({ flatFindFirst: { id: FLAT_ID, societyId: SOCIETY_ID } });
      const service = new UsersService(prisma);
      await expect(
        service.addToSociety(SOCIETY_ID, USER_ID, FLAT_ID, SystemRole.RESIDENT, false),
      ).resolves.toBeDefined();
      expect((prisma.societyMembership as any).findMany).not.toHaveBeenCalled();
      expect((prisma.societyMembership as any).upsert).toHaveBeenCalled();
    });
  });

  describe('society / user existence checks', () => {
    it('rejects when society does not exist', async () => {
      const service = new UsersService(makePrisma({ societyFindUnique: null }));
      await expect(
        service.addToSociety(SOCIETY_ID, USER_ID, undefined, SystemRole.RESIDENT, false),
      ).rejects.toThrow('Society not found');
    });

    it('rejects when user does not exist', async () => {
      const service = new UsersService(makePrisma({ userFindUnique: null }));
      await expect(
        service.addToSociety(SOCIETY_ID, USER_ID, undefined, SystemRole.RESIDENT, false),
      ).rejects.toThrow('User not found');
    });
  });

  describe('findOne society scoping (DEFECT-8)', () => {
    it('includes societyId membership filter when looking up a user', async () => {
      const prisma = makePrisma();
      const service = new UsersService(prisma);
      // findOne should throw because mock returns a user — just verify it ran the scoped query
      try { await service.findOne(USER_ID, SOCIETY_ID); } catch { /* not found is fine */ }
      expect((prisma.user as any).findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: USER_ID,
            memberships: expect.objectContaining({ some: expect.objectContaining({ societyId: SOCIETY_ID }) }),
          }),
        }),
      );
    });
  });
});

/**
 * Occupied-flat join approval gate: joinSociety() (auth.service.ts) creates a
 * PENDING membership when someone joins a flat that already has an active
 * resident. These methods are the admin's only way to review it.
 */
describe('UsersService — pending join approvals', () => {
  const MEMBERSHIP_ID = 'membership-pending-1';
  const ACTOR_ID = 'admin-1';

  function makePendingPrisma(pendingMembership: unknown = { id: MEMBERSHIP_ID, societyId: SOCIETY_ID, status: 'PENDING' }) {
    const membershipUpdate = jest.fn().mockResolvedValue({ id: MEMBERSHIP_ID, status: 'ACTIVE' });
    const auditLogCreate = jest.fn().mockResolvedValue({});
    const tx = { societyMembership: { update: membershipUpdate }, auditLog: { create: auditLogCreate } };
    return {
      societyMembership: {
        findFirst: jest.fn().mockResolvedValue(pendingMembership),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(tx)),
      __tx: tx,
    } as unknown as PrismaService & { __tx: typeof tx };
  }

  it('listPendingMemberships scopes strictly to PENDING rows in this society', async () => {
    const prisma = makePendingPrisma();
    const service = new UsersService(prisma);
    await service.listPendingMemberships(SOCIETY_ID);
    expect((prisma.societyMembership as any).findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { societyId: SOCIETY_ID, status: 'PENDING' } }),
    );
  });

  it('approveMembership flips status to ACTIVE and logs an audit entry', async () => {
    const prisma = makePendingPrisma();
    const service = new UsersService(prisma);
    await service.approveMembership(SOCIETY_ID, MEMBERSHIP_ID, ACTOR_ID);
    expect(prisma.__tx.societyMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: MEMBERSHIP_ID }, data: { status: 'ACTIVE' } }),
    );
    expect(prisma.__tx.auditLog.create).toHaveBeenCalled();
  });

  it('approveMembership throws NotFoundException for a membership outside this society or not PENDING', async () => {
    const prisma = makePendingPrisma(null);
    const service = new UsersService(prisma);
    await expect(service.approveMembership(SOCIETY_ID, MEMBERSHIP_ID, ACTOR_ID)).rejects.toThrow(NotFoundException);
  });

  it('rejectMembership sets status INACTIVE rather than deleting the row', async () => {
    const prisma = makePendingPrisma();
    const service = new UsersService(prisma);
    await service.rejectMembership(SOCIETY_ID, MEMBERSHIP_ID, ACTOR_ID);
    expect(prisma.__tx.societyMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: MEMBERSHIP_ID }, data: expect.objectContaining({ status: 'INACTIVE' }) }),
    );
  });
});
