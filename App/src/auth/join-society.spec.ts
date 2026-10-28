/**
 * Joining a society with its invite code. For an email that already has an
 * account this endpoint issues a session for that account, so it must be
 * proven with the account's own password — it used to ignore the password and
 * hand back tokens for whoever's email was typed. A member removed from a flat
 * earlier must be able to come back on their old membership.
 */

import { BadRequestException, ConflictException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

const SOCIETY = { id: 'soc-1', name: 'Green Valley', displayName: null, logoUrl: null, isActive: true, deletedAt: null };
const FLAT = { id: '11111111-1111-4111-8111-111111111111', flatCode: 'A-403', unitNumber: '403', building: { name: 'Block A' } };

const dto = (overrides: Record<string, unknown> = {}) => ({
  joinCode: 'GV12-ABCD',
  flatId: FLAT.id,
  firstName: 'Vinod',
  lastName: 'Kumar',
  email: 'Vinod@Example.com',
  phone: '+919812345678',
  password: 'the-right-password',
  ...overrides,
});

interface Fixture {
  existing?: Record<string, unknown> | null;
  activeOnFlat?: number;
}

async function build(f: Fixture = {}) {
  const hash = await argon2.hash('the-right-password');
  const existing = f.existing === undefined || f.existing === null ? null : { passwordHash: hash, isActive: true, deletedAt: null, id: 'user-1', email: 'vinod@example.com', firstName: 'Vinod', lastName: 'Kumar', phone: '+919812345678', isPlatformAdmin: false, createdAt: new Date('2026-09-01'), memberships: [], ...f.existing };

  const created: any[] = [];
  const tx: any = {
    user: {
      create: jest.fn(async ({ data }) => ({ id: 'new-user', isPlatformAdmin: false, createdAt: new Date(), ...data, memberships: [] })),
    },
    societyMembership: {
      count: jest.fn().mockResolvedValue(f.activeOnFlat ?? 0),
      create: jest.fn(async ({ data }) => {
        created.push(data);
        return { id: 'new-membership', ...data };
      }),
      update: jest.fn(async ({ where, data }) => ({ id: where.id, ...data })),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    society: { findUnique: jest.fn().mockResolvedValue(SOCIETY) },
    flat: { findFirst: jest.fn().mockResolvedValue(FLAT) },
    user: { findUnique: jest.fn().mockResolvedValue(existing) },
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;

  const service = new AuthService(prisma, {} as any, { get: jest.fn() } as any, {} as MailService);
  const tokens = jest.spyOn(service as any, 'generateTokens').mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
  return { service, prisma, tx, tokens, hash };
}

describe('AuthService.joinSociety — a new person', () => {
  it('creates the account and an active membership for the first person on a flat', async () => {
    const { service, tx, tokens } = await build();
    const out: any = await service.joinSociety(dto());
    expect(tx.user.create).toHaveBeenCalledTimes(1);
    expect(tx.societyMembership.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ societyId: SOCIETY.id, flatId: FLAT.id, role: 'RESIDENT', status: 'ACTIVE', isPrimary: true }),
    });
    expect(out.requiresApproval).toBe(false);
    expect(tokens).toHaveBeenCalledTimes(1);
  });

  it('puts a second person on an occupied flat into PENDING', async () => {
    const { service, tx } = await build({ activeOnFlat: 1 });
    const out: any = await service.joinSociety(dto());
    expect(tx.societyMembership.create.mock.calls[0][0].data).toMatchObject({ status: 'PENDING', isPrimary: false });
    expect(out.requiresApproval).toBe(true);
  });
});

describe('AuthService.joinSociety — an email that already has an account', () => {
  it('refuses the wrong password and issues no session (the account-takeover case)', async () => {
    const { service, tx, tokens } = await build({ existing: {} });
    await expect(service.joinSociety(dto({ password: 'a-guess-by-someone-else' }))).rejects.toThrow(ConflictException);
    expect(tx.societyMembership.create).not.toHaveBeenCalled();
    expect(tx.societyMembership.update).not.toHaveBeenCalled();
    expect(tokens).not.toHaveBeenCalled();
  });

  it('says what to do instead: use the existing password or Forgot password', async () => {
    const { service } = await build({ existing: {} });
    const err: any = await service.joinSociety(dto({ password: 'wrong-one' })).catch((e) => e);
    expect(err.message).toMatch(/already exists/);
    expect(err.message).toMatch(/Forgot password/);
  });

  it('with the right password, adds a membership to that account without creating another', async () => {
    const { service, tx, tokens } = await build({ existing: {} });
    await service.joinSociety(dto());
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.societyMembership.create).toHaveBeenCalledTimes(1);
    expect(tx.societyMembership.create.mock.calls[0][0].data.userId).toBe('user-1');
    expect(tokens).toHaveBeenCalledTimes(1);
  });

  it('never changes the stored password of an existing account', async () => {
    const { service, tx } = await build({ existing: {} });
    await service.joinSociety(dto());
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(tx.societyMembership.update).not.toHaveBeenCalled();
  });

  it.each([
    ['deactivated', { isActive: false }],
    ['deleted', { deletedAt: new Date() }],
  ])('refuses a %s account even with the right password', async (_label, extra) => {
    const { service, tokens } = await build({ existing: extra });
    await expect(service.joinSociety(dto())).rejects.toThrow(ConflictException);
    expect(tokens).not.toHaveBeenCalled();
  });

  it('does not reveal a flat membership to someone who does not know the password', async () => {
    const onFlat = { id: 'm1', flatId: FLAT.id, status: 'ACTIVE' };
    const { service } = await build({ existing: { memberships: [onFlat] } });
    const err: any = await service.joinSociety(dto({ password: 'wrong' })).catch((e) => e);
    expect(err.message).not.toMatch(/registered on this flat/);
  });

  it('refuses a person already active on this flat', async () => {
    const { service, tx } = await build({ existing: { memberships: [{ id: 'm1', flatId: FLAT.id, status: 'ACTIVE' }] } });
    await expect(service.joinSociety(dto())).rejects.toThrow(/already registered on this flat/);
    expect(tx.societyMembership.create).not.toHaveBeenCalled();
  });

  it('tells a person whose request is already waiting that it is waiting', async () => {
    const { service } = await build({ existing: { memberships: [{ id: 'm1', flatId: FLAT.id, status: 'PENDING' }] } });
    await expect(service.joinSociety(dto())).rejects.toThrow(/waiting for the admin/);
  });
});

describe('AuthService.joinSociety — a member who was removed and comes back', () => {
  const removed = { id: 'old-membership', flatId: FLAT.id, status: 'INACTIVE', leftAt: new Date('2026-10-01') };

  it('is brought back on the old membership — not refused as a duplicate, and no second row', async () => {
    const { service, tx, tokens } = await build({ existing: { memberships: [removed] } });
    const out: any = await service.joinSociety(dto());
    expect(tx.societyMembership.create).not.toHaveBeenCalled();
    expect(tx.societyMembership.update).toHaveBeenCalledWith({
      where: { id: 'old-membership' },
      data: expect.objectContaining({ status: 'ACTIVE', isPrimary: true, role: 'RESIDENT', leftAt: null }),
    });
    expect(out.requiresApproval).toBe(false);
    expect(tokens).toHaveBeenCalledTimes(1);
  });

  it('goes to PENDING when somebody else now lives on the flat, like any new joiner', async () => {
    const { service, tx } = await build({ existing: { memberships: [removed] }, activeOnFlat: 1 });
    const out: any = await service.joinSociety(dto());
    expect(tx.societyMembership.update.mock.calls[0][0].data).toMatchObject({ status: 'PENDING', isPrimary: false, leftAt: null });
    expect(out.requiresApproval).toBe(true);
  });

  it('still has to prove the account with its password', async () => {
    const { service, tx, tokens } = await build({ existing: { memberships: [removed] } });
    await expect(service.joinSociety(dto({ password: 'not-theirs' }))).rejects.toThrow(ConflictException);
    expect(tx.societyMembership.update).not.toHaveBeenCalled();
    expect(tokens).not.toHaveBeenCalled();
  });

  it('records that it was a rejoin', async () => {
    const { service, tx } = await build({ existing: { memberships: [removed] } });
    await service.joinSociety(dto());
    expect(tx.auditLog.create.mock.calls[0][0].data.newValues).toMatchObject({ method: 'join_code_rejoin', status: 'ACTIVE' });
  });

  it('can join a different flat while still removed from the old one', async () => {
    const { service, tx } = await build({ existing: { memberships: [{ ...removed, flatId: '22222222-2222-4222-8222-222222222222' }] } });
    await service.joinSociety(dto());
    expect(tx.societyMembership.create).toHaveBeenCalledTimes(1);
    expect(tx.societyMembership.update).not.toHaveBeenCalled();
  });
});

describe('AuthService.joinSociety — the invite code and flat', () => {
  it('rejects an unknown code', async () => {
    const { service, prisma } = await build();
    (prisma.society.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.joinSociety(dto())).rejects.toThrow(BadRequestException);
  });

  it('rejects a flat from another society', async () => {
    const { service, prisma } = await build();
    (prisma.flat.findFirst as jest.Mock).mockResolvedValue(null);
    await expect(service.joinSociety(dto())).rejects.toThrow(BadRequestException);
  });
});
