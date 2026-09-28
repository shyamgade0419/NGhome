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

describe('SocietiesService.listPlatformUsers', () => {
  function usersPrisma(rows: unknown[] = [], total = 0) {
    return {
      user: {
        findMany: jest.fn().mockResolvedValue(rows),
        count: jest.fn().mockResolvedValue(total),
      },
    } as unknown as PrismaService;
  }

  it('returns {data, meta} so the response interceptor unwraps it', async () => {
    const result = await new SocietiesService(usersPrisma([{ id: 'u1' }], 41)).listPlatformUsers({
      page: 2,
      limit: 20,
    });

    expect(result.data).toEqual([{ id: 'u1' }]);
    expect(result.meta).toMatchObject({ total: 41, page: 2, limit: 20, totalPages: 3 });
    expect(result).not.toHaveProperty('total');
  });

  it('never selects passwordHash', async () => {
    const prisma = usersPrisma();
    await new SocietiesService(prisma).listPlatformUsers({ page: 1, limit: 20 });

    const [args] = (prisma.user.findMany as jest.Mock).mock.calls[0];
    expect(args.select).toBeDefined();
    expect(args.select.passwordHash).toBeUndefined();
    expect(args.include).toBeUndefined();
  });

  it('excludes soft-deleted users and only lists active memberships', async () => {
    const prisma = usersPrisma();
    await new SocietiesService(prisma).listPlatformUsers({ page: 1, limit: 20 });

    const [args] = (prisma.user.findMany as jest.Mock).mock.calls[0];
    expect(args.where).toMatchObject({ deletedAt: null });
    expect(args.select.memberships.where).toEqual({ status: 'ACTIVE' });
  });

  it('searches name, email and phone, and applies the same filter to the count', async () => {
    const prisma = usersPrisma();
    await new SocietiesService(prisma).listPlatformUsers({ page: 1, limit: 20, search: '  ramesh ' });

    const [args] = (prisma.user.findMany as jest.Mock).mock.calls[0];
    expect(args.where.OR).toHaveLength(4);
    expect(args.where.OR[0]).toEqual({ firstName: { contains: 'ramesh', mode: 'insensitive' } });
    const [countArgs] = (prisma.user.count as jest.Mock).mock.calls[0];
    expect(countArgs.where).toEqual(args.where);
  });

  it('adds no search filter when the term is blank', async () => {
    const prisma = usersPrisma();
    await new SocietiesService(prisma).listPlatformUsers({ page: 1, limit: 20, search: '   ' });

    const [args] = (prisma.user.findMany as jest.Mock).mock.calls[0];
    expect(args.where.OR).toBeUndefined();
  });
});

describe('SocietiesService.getPlatformOverview', () => {
  function overviewPrisma() {
    return {
      society: {
        findUnique: jest.fn().mockResolvedValue({ id: SOCIETY_ID, name: 'Horizon', isActive: true }),
      },
      societyMembership: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([
          { role: 'SOCIETY_ADMIN', _count: { _all: 1 } },
          { role: 'RESIDENT', _count: { _all: 9 } },
        ]),
      },
      flat: {
        groupBy: jest.fn().mockResolvedValue([
          { status: 'ACTIVE', _count: { _all: 8 } },
          { status: 'VACANT', _count: { _all: 2 } },
        ]),
      },
      maintenanceBill: {
        aggregate: jest.fn().mockResolvedValue({
          _count: { _all: 10 },
          _sum: { totalAmount: '50000', paidAmount: '30000', pendingAmount: '20000' },
        }),
        count: jest.fn().mockResolvedValue(3),
      },
      paymentSubmission: { count: jest.fn().mockResolvedValue(2) },
      account: {
        aggregate: jest.fn().mockResolvedValue({ _count: { _all: 2 }, _sum: { currentBalance: '12345' } }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ lastLoginAt: new Date('2026-09-20T10:00:00Z') }),
        count: jest.fn().mockResolvedValue(6),
      },
      auditLog: { findMany: jest.fn().mockResolvedValue([{ id: 'a1' }]) },
    } as unknown as PrismaService;
  }

  it('summarises flats, members, billing, accounts and activity', async () => {
    const overview = await new SocietiesService(overviewPrisma()).getPlatformOverview(SOCIETY_ID);

    expect(overview.flats).toEqual({ total: 10, byStatus: { ACTIVE: 8, VACANT: 2 } });
    expect(overview.members).toMatchObject({
      total: 10,
      byRole: { SOCIETY_ADMIN: 1, RESIDENT: 9 },
      activeLast30Days: 6,
      lastLoginAt: new Date('2026-09-20T10:00:00Z'),
    });
    expect(overview.billing).toEqual({
      billsPublished: 10,
      totalBilled: '50000',
      totalCollected: '30000',
      totalPending: '20000',
      overdueBills: 3,
      paymentsAwaitingReview: 2,
    });
    expect(overview.accounts).toEqual({ count: 2, totalBalance: '12345' });
    expect(overview.recentActivity).toEqual([{ id: 'a1' }]);
  });

  it('scopes every query to the requested society', async () => {
    const prisma = overviewPrisma();
    await new SocietiesService(prisma).getPlatformOverview(SOCIETY_ID);

    expect((prisma.flat.groupBy as jest.Mock).mock.calls[0][0].where.societyId).toBe(SOCIETY_ID);
    expect((prisma.maintenanceBill.aggregate as jest.Mock).mock.calls[0][0].where.societyId).toBe(SOCIETY_ID);
    expect((prisma.paymentSubmission.count as jest.Mock).mock.calls[0][0].where.societyId).toBe(SOCIETY_ID);
    expect((prisma.account.aggregate as jest.Mock).mock.calls[0][0].where.societyId).toBe(SOCIETY_ID);
    expect((prisma.auditLog.findMany as jest.Mock).mock.calls[0][0].where.societyId).toBe(SOCIETY_ID);
  });

  it('counts only published bills, so unpublished drafts do not inflate what is owed', async () => {
    const prisma = overviewPrisma();
    await new SocietiesService(prisma).getPlatformOverview(SOCIETY_ID);

    expect((prisma.maintenanceBill.aggregate as jest.Mock).mock.calls[0][0].where.isPublished).toBe(true);
  });

  it('ignores never-logged-in users when finding the last login', async () => {
    const prisma = overviewPrisma();
    await new SocietiesService(prisma).getPlatformOverview(SOCIETY_ID);

    expect((prisma.user.findFirst as jest.Mock).mock.calls[0][0].where.lastLoginAt).toEqual({ not: null });
  });

  it('reports zero, not null, when a society has no bills or accounts yet', async () => {
    const prisma = overviewPrisma();
    (prisma.maintenanceBill.aggregate as jest.Mock).mockResolvedValue({
      _count: { _all: 0 },
      _sum: { totalAmount: null, paidAmount: null, pendingAmount: null },
    });
    (prisma.account.aggregate as jest.Mock).mockResolvedValue({ _count: { _all: 0 }, _sum: { currentBalance: null } });
    (prisma.user.findFirst as jest.Mock).mockResolvedValue(null);

    const overview = await new SocietiesService(prisma).getPlatformOverview(SOCIETY_ID);

    expect(overview.billing.totalBilled).toBe('0');
    expect(overview.accounts.totalBalance).toBe('0');
    expect(overview.members.lastLoginAt).toBeNull();
  });

  it('refuses a society that does not exist', async () => {
    const prisma = overviewPrisma();
    (prisma.society.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(new SocietiesService(prisma).getPlatformOverview('nope')).rejects.toThrow(NotFoundException);
  });
});

describe('SocietiesService.getPlatformStats — newThisMonth', () => {
  it('counts only societies created since the start of the current month (UTC)', async () => {
    const now = new Date();
    const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 1));
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 60_000);
    const prisma = makePrisma({
      society: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'a', isActive: true, createdAt: thisMonth },
          { id: 'b', isActive: true, createdAt: thisMonth },
          { id: 'c', isActive: true, createdAt: lastMonth },
        ]),
        findUnique: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
    });

    const stats = await new SocietiesService(prisma).getPlatformStats();
    expect(stats.newThisMonth).toBe(2);
  });
});

describe('SocietiesService.softDelete', () => {
  it('sets deletedAt and returns the updated row, touching no other table', async () => {
    const prisma = makePrisma({
      society: {
        findUnique: jest.fn().mockResolvedValue({ id: SOCIETY_ID, isActive: true, deletedAt: null }),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: SOCIETY_ID, ...data })),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    });

    const result = await new SocietiesService(prisma).softDelete(SOCIETY_ID, ACTOR_ID);

    expect((prisma.society.update as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { id: SOCIETY_ID },
      data: { deletedAt: expect.any(Date) },
    });
    expect(result.deletedAt).toBeInstanceOf(Date);
  });

  it('records the actor and marks the audit entry as a deletion', async () => {
    const prisma = makePrisma({
      society: {
        findUnique: jest.fn().mockResolvedValue({ id: SOCIETY_ID, isActive: true, deletedAt: null }),
        update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: SOCIETY_ID, ...data })),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    });

    await new SocietiesService(prisma).softDelete(SOCIETY_ID, ACTOR_ID);

    const [audit] = (prisma.auditLog.create as jest.Mock).mock.calls[0];
    expect(audit.data).toMatchObject({
      societyId: SOCIETY_ID,
      actorId: ACTOR_ID,
      action: 'CONFIG_CHANGED',
      newValues: expect.objectContaining({ action: 'SOCIETY_DELETED' }),
    });
  });

  it('refuses a society that does not exist', async () => {
    const prisma = makePrisma({
      society: { findUnique: jest.fn().mockResolvedValue(null), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    });

    await expect(new SocietiesService(prisma).softDelete('nope', ACTOR_ID)).rejects.toThrow(NotFoundException);
    expect((prisma.society as any).update).not.toHaveBeenCalled();
  });

  it('a deleted society is excluded from findAll — findOne already scopes deletedAt: null, and findAll shares that scope', async () => {
    const prisma = makePrisma({
      society: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    });

    await new SocietiesService(prisma).findAll(1, 20);

    const [args] = (prisma.society.findMany as jest.Mock).mock.calls[0];
    expect(args.where).toMatchObject({ deletedAt: null });
  });
});
