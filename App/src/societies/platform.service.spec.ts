/**
 * Platform console.
 *
 * isActive has existed on Society since the beginning with nothing able to
 * change it — no endpoint, no UI — so a society could be created but never
 * switched off. And there was no platform-wide view at all: the console
 * listed societies and nothing else.
 */

import { SocietiesService } from './societies.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

const ACTOR_ID = 'platform-admin-1';
const SOCIETY_ID = 'society-1';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    society: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'society-1', isActive: true },
        { id: 'society-2', isActive: true },
        { id: 'society-3', isActive: false },
      ]),
      findUnique: jest.fn().mockResolvedValue({ id: SOCIETY_ID, isActive: true }),
      update: jest.fn().mockResolvedValue({ id: SOCIETY_ID, isActive: false }),
      count: jest.fn(),
    },
    building: { count: jest.fn().mockResolvedValue(7) },
    flat: { count: jest.fn().mockResolvedValue(120) },
    societyMembership: {
      findMany: jest.fn().mockResolvedValue([{ userId: 'u1' }, { userId: 'u2' }]),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    ...overrides,
  } as unknown as PrismaService;
}

describe('SocietiesService.getPlatformStats', () => {
  it('reports totals with active and suspended split out', async () => {
    const prisma = makePrisma();
    const stats = await new SocietiesService(prisma).getPlatformStats();

    expect(stats).toMatchObject({
      societies: 3,
      activeSocieties: 2,
      suspendedSocieties: 1,
      buildings: 7,
      flats: 120,
    });
  });

  it('scopes flats and buildings to live societies, not the whole table', async () => {
    // Societies are soft-deleted and Flat carries only a societyId, so an
    // unscoped count would include a deleted society's flats and disagree
    // with the list shown beneath it.
    const prisma = makePrisma();
    await new SocietiesService(prisma).getPlatformStats();

    const [flatArgs] = (prisma.flat.count as jest.Mock).mock.calls[0];
    expect(flatArgs.where.societyId.in).toEqual(['society-1', 'society-2', 'society-3']);
    expect(flatArgs.where.deletedAt).toBeNull();
  });

  it('counts a person once even when they hold several memberships', async () => {
    const prisma = makePrisma();
    await new SocietiesService(prisma).getPlatformStats();

    const membershipCalls = (prisma.societyMembership.findMany as jest.Mock).mock.calls;
    for (const [args] of membershipCalls) {
      expect(args.distinct).toEqual(['userId']);
    }
  });
});

describe('SocietiesService.setActive', () => {
  it('suspends a society without deleting anything', async () => {
    const prisma = makePrisma();
    await new SocietiesService(prisma).setActive(SOCIETY_ID, false, ACTOR_ID);

    expect(prisma.society.update).toHaveBeenCalledWith({
      where: { id: SOCIETY_ID },
      data: { isActive: false },
    });
  });

  it('records who suspended it, and what it was before', async () => {
    const prisma = makePrisma();
    await new SocietiesService(prisma).setActive(SOCIETY_ID, false, ACTOR_ID);

    const [auditArg] = (prisma.auditLog.create as jest.Mock).mock.calls[0];
    expect(auditArg.data).toMatchObject({ societyId: SOCIETY_ID, actorId: ACTOR_ID });
    expect(auditArg.data.oldValues).toMatchObject({ isActive: true });
    expect(auditArg.data.newValues).toMatchObject({ action: 'SOCIETY_SUSPENDED' });
  });

  it('labels a reinstatement as such', async () => {
    const prisma = makePrisma({
      society: {
        findUnique: jest.fn().mockResolvedValue({ id: SOCIETY_ID, isActive: false }),
        update: jest.fn().mockResolvedValue({ id: SOCIETY_ID, isActive: true }),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    });
    await new SocietiesService(prisma).setActive(SOCIETY_ID, true, ACTOR_ID);

    const [auditArg] = (prisma.auditLog.create as jest.Mock).mock.calls[0];
    expect(auditArg.data.newValues).toMatchObject({ action: 'SOCIETY_REINSTATED' });
  });

  it('refuses a society that does not exist', async () => {
    const prisma = makePrisma({
      society: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    });
    await expect(
      new SocietiesService(prisma).setActive('nope', false, ACTOR_ID),
    ).rejects.toThrow(NotFoundException);
    expect((prisma.society as any).update).not.toHaveBeenCalled();
  });
});
