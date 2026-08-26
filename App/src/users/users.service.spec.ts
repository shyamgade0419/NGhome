/**
 * DEFECT-1: addToSociety flat validation unit tests.
 * DEFECT-8: Society-scoped user operations.
 */

import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { SystemRole } from '@prisma/client';

const SOCIETY_ID = 'society-a';
const OTHER_SOCIETY_ID = 'society-b';
const USER_ID = 'user-1';
const FLAT_ID = 'flat-a-1';
const FLAT_B_ID = 'flat-b-1';

function makePrisma(overrides: {
  societyFindUnique?: unknown;
  userFindUnique?: unknown;
  flatFindFirst?: unknown;
  membershipUpsert?: unknown;
} = {}) {
  const defaults = {
    societyFindUnique: 'societyFindUnique' in overrides ? overrides.societyFindUnique : { id: SOCIETY_ID },
    userFindUnique: 'userFindUnique' in overrides ? overrides.userFindUnique : { id: USER_ID },
    flatFindFirst: 'flatFindFirst' in overrides ? overrides.flatFindFirst : { id: FLAT_ID, societyId: SOCIETY_ID },
    membershipUpsert: overrides.membershipUpsert ?? { id: 'membership-1' },
  };

  return {
    society: { findUnique: jest.fn().mockResolvedValue(defaults.societyFindUnique) },
    user: {
      findUnique: jest.fn().mockResolvedValue(defaults.userFindUnique),
      findFirst: jest.fn().mockResolvedValue({ id: USER_ID, memberships: [] }),
    },
    flat: { findFirst: jest.fn().mockResolvedValue(defaults.flatFindFirst) },
    societyMembership: { upsert: jest.fn().mockResolvedValue(defaults.membershipUpsert) },
  } as unknown as PrismaService;
}

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
