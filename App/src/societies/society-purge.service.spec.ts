import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SocietyPurgeService } from './society-purge.service';
import { lowerFirst, purgeOrder } from './society-purge.plan';

const SOCIETY_ID = 'soc-1';
const ACTOR_ID = 'platform-admin-1';

interface Fixture {
  society?: object | null;
  docs?: { fileKey: string }[];
  exclusiveUsers?: { id: string }[];
  /** Per-model delete counts; anything else deletes 0 rows. */
  counts?: Record<string, number>;
  failOn?: string;
  /** Keys isSocietyKey accepts. */
  societyKeys?: string[];
}

function build(f: Fixture = {}) {
  const calls: string[] = [];
  const tx: any = {
    user: {
      findMany: jest.fn(async (args: unknown) => {
        calls.push('user.findMany');
        tx.userQuery = args;
        return f.exclusiveUsers ?? [];
      }),
      deleteMany: jest.fn(async () => {
        calls.push('user.deleteMany');
        return { count: (f.exclusiveUsers ?? []).length };
      }),
    },
    society: {
      delete: jest.fn(async () => {
        calls.push('society.delete');
        return {};
      }),
    },
    auditLog: {
      deleteMany: jest.fn(async (args: any) => {
        calls.push(args.where.actorId ? 'auditLog.deleteMany(actors)' : 'auditLog.deleteMany(society)');
        return { count: 0 };
      }),
      create: jest.fn(async () => {
        calls.push('auditLog.create');
        return {};
      }),
    },
  };

  // Every purged model gets a deleteMany that records its call (auditLog is
  // shared between the societyId purge and the actor purge above).
  for (const model of purgeOrder()) {
    const key = lowerFirst(model);
    const target = tx[key] ?? (tx[key] = {});
    const actorAware = target.deleteMany as jest.Mock | undefined;
    target.deleteMany = jest.fn(async (args: any) => {
      if (f.failOn === model) throw new Error(`FK violation on ${model}`);
      if (actorAware && args.where.actorId) return actorAware(args);
      calls.push(`${model}.deleteMany`);
      return { count: f.counts?.[model] ?? 0 };
    });
  }

  const prisma: any = {
    society: {
      findUnique: jest.fn(async () =>
        f.society === undefined ? { id: SOCIETY_ID, name: 'Green Valley', displayName: null } : f.society,
      ),
    },
    document: { findMany: jest.fn(async () => f.docs ?? []) },
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  };
  const storage: any = { remove: jest.fn(async () => undefined) };
  const paths: any = {
    isSocietyKey: jest.fn(async (_id: string, key: string) => (f.societyKeys ?? []).includes(key)),
  };

  const service = new SocietyPurgeService(prisma, storage, paths);
  return { service, prisma, tx, storage, paths, calls };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('SocietyPurgeService.purge', () => {
  it('throws NotFound for a society that does not exist', async () => {
    const { service, prisma } = build({ society: null });
    await expect(service.purge('nope', 'x', ACTOR_ID)).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each(['', '   ', 'green valley', 'Green Valley 2', 'Other'])(
    'refuses to delete anything when the typed name is %j',
    async (typed) => {
      const { service, prisma, storage } = build();
      await expect(service.purge(SOCIETY_ID, typed, ACTOR_ID)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(storage.remove).not.toHaveBeenCalled();
    },
  );

  it('accepts the name with stray spaces around it, as the console does', async () => {
    const { service } = build();
    await expect(service.purge(SOCIETY_ID, '  Green Valley ', ACTOR_ID)).resolves.toMatchObject({ name: 'Green Valley' });
  });

  it('confirms against the display name when the society has one', async () => {
    const { service } = build({ society: { id: SOCIETY_ID, name: 'Legal Name Pvt', displayName: 'Green Valley' } });
    await expect(service.purge(SOCIETY_ID, 'Legal Name Pvt', ACTOR_ID)).rejects.toThrow(BadRequestException);
    await expect(service.purge(SOCIETY_ID, 'Green Valley', ACTOR_ID)).resolves.toBeDefined();
  });

  it('purges every table in foreign-key order, then users, then the society, then writes the audit record', async () => {
    const { service, calls } = build({ exclusiveUsers: [{ id: 'u1' }, { id: 'u2' }] });
    await service.purge(SOCIETY_ID, 'Green Valley', ACTOR_ID);

    // The audit table is purged by societyId in its place in the order, and
    // again by actor once the people are known.
    expect(calls).toEqual([
      'user.findMany',
      ...purgeOrder().map((m) => `${m}.deleteMany`),
      'auditLog.deleteMany(actors)',
      'user.deleteMany',
      'society.delete',
      'auditLog.create',
    ]);
  });

  it('chooses only people who belong to no other society and are not platform admins', async () => {
    const { service, tx } = build();
    await service.purge(SOCIETY_ID, 'Green Valley', ACTOR_ID);
    expect(tx.userQuery).toEqual({
      where: {
        isPlatformAdmin: false,
        memberships: { some: { societyId: SOCIETY_ID }, none: { societyId: { not: SOCIETY_ID } } },
      },
      select: { id: true },
    });
  });

  it('deletes only those people, and their audit rows first (the actor column would block them)', async () => {
    const { service, tx } = build({ exclusiveUsers: [{ id: 'u1' }, { id: 'u2' }] });
    await service.purge(SOCIETY_ID, 'Green Valley', ACTOR_ID);
    expect(tx.auditLog.deleteMany).toHaveBeenCalledWith({ where: { actorId: { in: ['u1', 'u2'] } } });
    expect(tx.user.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['u1', 'u2'] } } });
  });

  it('touches no user rows when nobody is exclusive to the society', async () => {
    const { service, tx } = build({ exclusiveUsers: [] });
    await service.purge(SOCIETY_ID, 'Green Valley', ACTOR_ID);
    expect(tx.user.deleteMany).not.toHaveBeenCalled();
  });

  it('scopes every table delete to this society and nothing else', async () => {
    const { service, tx } = build();
    await service.purge(SOCIETY_ID, 'Green Valley', ACTOR_ID);
    for (const model of purgeOrder()) {
      for (const [args] of tx[lowerFirst(model)].deleteMany.mock.calls) {
        expect(args).toEqual({ where: { societyId: SOCIETY_ID } });
      }
    }
    expect(tx.society.delete).toHaveBeenCalledWith({ where: { id: SOCIETY_ID } });
  });

  it('records who erased what, with no societyId (that society no longer exists)', async () => {
    const { service, tx } = build({ counts: { Flat: 12, Expense: 3 }, exclusiveUsers: [{ id: 'u1' }] });
    const result = await service.purge(SOCIETY_ID, 'Green Valley', ACTOR_ID);

    expect(result).toMatchObject({ id: SOCIETY_ID, name: 'Green Valley', deleted: { Flat: 12, Expense: 3 }, usersRemoved: 1 });
    const data = tx.auditLog.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ societyId: null, actorId: ACTOR_ID, entityType: 'Society', entityId: SOCIETY_ID });
    expect(data.newValues).toMatchObject({ action: 'SOCIETY_PURGED', deleted: { Flat: 12, Expense: 3 }, usersRemoved: 1 });
  });

  it('runs inside one transaction with room for a large society', async () => {
    const { service, prisma } = build();
    await service.purge(SOCIETY_ID, 'Green Valley', ACTOR_ID);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][1]).toMatchObject({ timeout: 120_000 });
  });

  describe('when the database objects', () => {
    it('rolls back, reports the failure and removes no stored file', async () => {
      const { service, storage, tx } = build({
        docs: [{ fileKey: 'uploads/soc-1/a.pdf' }],
        societyKeys: ['uploads/soc-1/a.pdf'],
        failOn: 'Account',
      });
      await expect(service.purge(SOCIETY_ID, 'Green Valley', ACTOR_ID)).rejects.toThrow('FK violation on Account');
      await flush();
      expect(storage.remove).not.toHaveBeenCalled();
      expect(tx.society.delete).not.toHaveBeenCalled();
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('stored files', () => {
    it('removes only keys inside this society’s own folder, after the commit', async () => {
      const { service, storage, calls } = build({
        docs: [{ fileKey: 'uploads/soc-1/a.pdf' }, { fileKey: 'uploads/other/b.pdf' }, { fileKey: 'uploads/soc-1/c.png' }],
        societyKeys: ['uploads/soc-1/a.pdf', 'uploads/soc-1/c.png'],
      });
      const result = await service.purge(SOCIETY_ID, 'Green Valley', ACTOR_ID);
      await flush();

      expect(result.filesQueued).toBe(2);
      expect(storage.remove.mock.calls.map((c: string[]) => c[0])).toEqual(['uploads/soc-1/a.pdf', 'uploads/soc-1/c.png']);
      expect(calls[calls.length - 1]).toBe('auditLog.create'); // storage came after the whole transaction
    });

    it('only looks at files held on the SFTP store', async () => {
      const { service, prisma } = build();
      await service.purge(SOCIETY_ID, 'Green Valley', ACTOR_ID);
      expect(prisma.document.findMany).toHaveBeenCalledWith({
        where: { societyId: SOCIETY_ID, storageProvider: 'sftp' },
        select: { fileKey: true },
      });
    });

    it('checks the key against the society folder before the society row is gone', async () => {
      const { service, paths, prisma } = build({ docs: [{ fileKey: 'k' }] });
      await service.purge(SOCIETY_ID, 'Green Valley', ACTOR_ID);
      expect(paths.isSocietyKey).toHaveBeenCalledWith(SOCIETY_ID, 'k');
      expect(paths.isSocietyKey.mock.invocationCallOrder[0]).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]);
    });
  });
});
