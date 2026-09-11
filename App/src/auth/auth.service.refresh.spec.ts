/**
 * Refresh-token rotation must be single-use even under a genuine race: two
 * requests presenting the identical refresh token at the same moment must
 * not both come away with a valid session.
 *
 * The mock below models the refresh_tokens "table" as a real, mutable Map
 * and gives updateMany() the same check-and-mutate-in-one-step semantics a
 * single Postgres UPDATE ... WHERE statement has — nothing async happens
 * between reading the current isRevoked value and writing the new one, the
 * same way a database statement's WHERE-then-SET is one atomic operation
 * from the caller's point of view. That is what makes Promise.all([...])
 * below a faithful stand-in for a real race, and is exactly the property
 * auth.service.ts's fix depends on: whichever of two concurrent updateMany
 * calls runs first flips the row and reports count 1; the other's WHERE
 * clause (isRevoked: false) no longer matches and it reports count 0. This
 * proves the application logic is correct given a truly atomic single
 * statement, which is what Postgres provides for a real UPDATE — it is not
 * a substitute for testing against a live database under real concurrent
 * load, which this sandbox has no access to.
 */

import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

function hashOf(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function makeStatefulPrisma() {
  const refreshTokens = new Map<string, any>();
  const users = new Map<string, any>();
  let nextId = 1;

  const findUnique = async ({ where, include }: any) => {
    const row = [...refreshTokens.values()].find((r) => r.tokenHash === where.tokenHash);
    if (!row) return null;
    return include?.user ? { ...row, user: users.get(row.userId) } : { ...row };
  };

  // The one operation the whole test depends on being atomic — see the
  // file-level comment above.
  const updateMany = async ({ where, data }: any) => {
    let count = 0;
    for (const row of refreshTokens.values()) {
      const matches = Object.entries(where).every(([k, v]) => row[k] === v);
      if (matches) {
        Object.assign(row, data);
        count++;
      }
    }
    return { count };
  };

  const create = async ({ data }: any) => {
    const id = `rt-${nextId++}`;
    const row = { id, isRevoked: false, createdAt: new Date(), updatedAt: new Date(), ...data };
    refreshTokens.set(id, row);
    return { ...row };
  };

  const refreshTokenApi = {
    findUnique: jest.fn(findUnique),
    updateMany: jest.fn(updateMany),
    create: jest.fn(create),
  };

  const prisma = {
    refreshToken: refreshTokenApi,
    $transaction: jest.fn(async (cb: any) =>
      cb({ refreshToken: { updateMany: refreshTokenApi.updateMany, create: refreshTokenApi.create } }),
    ),
  } as unknown as PrismaService;

  function seedUser(id: string, overrides: Record<string, unknown> = {}) {
    users.set(id, { id, email: 'resident@example.com', isPlatformAdmin: false, isActive: true, ...overrides });
    return users.get(id);
  }

  function seedToken(overrides: Record<string, unknown> = {}) {
    const id = `rt-${nextId++}`;
    const row = {
      id,
      userId: 'user-1',
      tokenHash: hashOf('raw-token'),
      isRevoked: false,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      societyId: 'society-a',
      membershipId: 'membership-1',
      role: 'RESIDENT',
      flatId: 'flat-1',
      ...overrides,
    };
    refreshTokens.set(id, row);
    return row;
  }

  return { prisma, refreshTokens, users, seedUser, seedToken };
}

function makeService(prisma: PrismaService) {
  const jwtService = { sign: jest.fn().mockReturnValue('signed-access-token') } as unknown as JwtService;
  const configService = {
    get: (key: string) => ({ 'jwt.accessSecret': 's', 'jwt.accessExpiration': '15m', 'jwt.refreshExpiration': '7d' })[key],
  } as unknown as ConfigService;
  const mailService = {} as unknown as MailService;
  return new AuthService(prisma, jwtService, configService, mailService);
}

describe('AuthService.refresh — single-use rotation', () => {
  it('a fresh, valid refresh token works once', async () => {
    const { prisma, seedUser, seedToken } = makeStatefulPrisma();
    seedUser('user-1');
    seedToken();
    const service = makeService(prisma);

    const result = await service.refresh({ refreshToken: 'raw-token' } as any);
    expect(result.accessToken).toBe('signed-access-token');
    expect(result.refreshToken).toBeDefined();
  });

  it('the same refresh token used twice in sequence: the second use fails', async () => {
    const { prisma, seedUser, seedToken } = makeStatefulPrisma();
    seedUser('user-1');
    seedToken();
    const service = makeService(prisma);

    await service.refresh({ refreshToken: 'raw-token' } as any);
    await expect(service.refresh({ refreshToken: 'raw-token' } as any)).rejects.toThrow(UnauthorizedException);
  });

  it('a revoked token cannot be used', async () => {
    const { prisma, seedUser, seedToken } = makeStatefulPrisma();
    seedUser('user-1');
    seedToken({ isRevoked: true });
    const service = makeService(prisma);

    await expect(service.refresh({ refreshToken: 'raw-token' } as any)).rejects.toThrow(UnauthorizedException);
  });

  it('an expired token cannot be refreshed', async () => {
    const { prisma, seedUser, seedToken } = makeStatefulPrisma();
    seedUser('user-1');
    seedToken({ expiresAt: new Date(Date.now() - 1000) });
    const service = makeService(prisma);

    await expect(service.refresh({ refreshToken: 'raw-token' } as any)).rejects.toThrow(UnauthorizedException);
  });

  it('a deactivated user cannot refresh even with an otherwise-valid token', async () => {
    const { prisma, seedUser, seedToken } = makeStatefulPrisma();
    seedUser('user-1', { isActive: false });
    seedToken();
    const service = makeService(prisma);

    await expect(service.refresh({ refreshToken: 'raw-token' } as any)).rejects.toThrow(UnauthorizedException);
  });

  it('rotation creates exactly one successor token, carrying the same society/flat/role context', async () => {
    const { prisma, refreshTokens, seedUser, seedToken } = makeStatefulPrisma();
    seedUser('user-1');
    const original = seedToken({ societyId: 'society-x', flatId: 'flat-9', role: 'SOCIETY_ADMIN', membershipId: 'm-9' });
    const service = makeService(prisma);

    await service.refresh({ refreshToken: 'raw-token' } as any);

    const all = [...refreshTokens.values()];
    expect(all).toHaveLength(2); // the original (now revoked) + exactly one successor
    const successor = all.find((t) => t.id !== original.id)!;
    expect(successor.isRevoked).toBe(false);
    expect(successor.societyId).toBe('society-x');
    expect(successor.flatId).toBe('flat-9');
    expect(successor.role).toBe('SOCIETY_ADMIN');
    expect(successor.membershipId).toBe('m-9');
  });

  it('a failed rotation attempt (already-revoked race loser) leaves no successor token behind', async () => {
    const { prisma, refreshTokens, seedUser, seedToken } = makeStatefulPrisma();
    seedUser('user-1');
    seedToken({ isRevoked: true }); // simulates arriving just after another request won the race
    const service = makeService(prisma);

    await expect(service.refresh({ refreshToken: 'raw-token' } as any)).rejects.toThrow();
    expect(refreshTokens.size).toBe(1); // only the original row — no successor was created
  });

  describe('concurrent use of the identical refresh token', () => {
    it('exactly one of two simultaneous requests succeeds, and exactly one successor token exists', async () => {
      const { prisma, refreshTokens, seedUser, seedToken } = makeStatefulPrisma();
      seedUser('user-1');
      seedToken();
      const service = makeService(prisma);

      const results = await Promise.allSettled([
        service.refresh({ refreshToken: 'raw-token' } as any),
        service.refresh({ refreshToken: 'raw-token' } as any),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(UnauthorizedException);

      const all = [...refreshTokens.values()];
      const live = all.filter((t) => !t.isRevoked);
      expect(all).toHaveLength(2); // original (revoked) + exactly one successor
      expect(live).toHaveLength(1);
    });

    it('five simultaneous requests with the same token: still exactly one winner', async () => {
      const { prisma, refreshTokens, seedUser, seedToken } = makeStatefulPrisma();
      seedUser('user-1');
      seedToken();
      const service = makeService(prisma);

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => service.refresh({ refreshToken: 'raw-token' } as any)),
      );

      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(4);
      expect([...refreshTokens.values()].filter((t) => !t.isRevoked)).toHaveLength(1);
    });
  });
});
