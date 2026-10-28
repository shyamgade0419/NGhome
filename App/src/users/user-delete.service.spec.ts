import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UserDeleteService, USER_REFERENCES } from './user-delete.service';

describe('USER_REFERENCES', () => {
  const pointingAtUser = Prisma.dmmf.datamodel.models.flatMap((m) =>
    m.fields
      .filter((f) => f.kind === 'object' && f.type === 'User' && (f.relationFromFields?.length ?? 0) > 0)
      .map((f) => ({ key: `${m.name}.${f.relationFromFields![0]}`, field: f })),
  );

  it('covers every relation in the schema that points at User', () => {
    const missing = pointingAtUser.map((p) => p.key).filter((k) => !USER_REFERENCES[k]);
    expect(missing).toEqual([]);
  });

  it('lists nothing that is not in the schema', () => {
    const real = new Set(pointingAtUser.map((p) => p.key));
    expect(Object.keys(USER_REFERENCES).filter((k) => !real.has(k))).toEqual([]);
  });

  it('only trusts "cascade" where the schema really cascades', () => {
    const wrong = pointingAtUser
      .filter((p) => USER_REFERENCES[p.key]?.action === 'cascade' && p.field.relationOnDelete !== 'Cascade')
      .map((p) => p.key);
    expect(wrong).toEqual([]);
  });

  it('only clears a pointer that is optional', () => {
    const wrong = pointingAtUser.filter((p) => USER_REFERENCES[p.key]?.action === 'null' && p.field.isRequired).map((p) => p.key);
    expect(wrong).toEqual([]);
  });
});

describe('UserDeleteService', () => {
  const ACTOR = 'actor-1';
  const TARGET = 'user-1';

  function build(over: { user?: Record<string, unknown> | null; counts?: Record<string, number>; otherAdmins?: number; otherPlatformAdmins?: number } = {}) {
    const user =
      over.user === undefined
        ? {
            id: TARGET,
            firstName: 'Anil',
            lastName: 'Kumar',
            email: 'Anil@Example.com',
            phone: '9000000001',
            isActive: true,
            isPlatformAdmin: false,
            memberships: [{ role: 'RESIDENT', status: 'INACTIVE', societyId: 's1', society: { name: 'Green', displayName: null, deletedAt: null } }],
          }
        : over.user;
    const counts = over.counts ?? {};
    const countFor = (name: string) => jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const field = Object.keys(where)[0];
      return counts[`${name}.${field}`] ?? 0;
    });
    const tx: Record<string, any> = {
      user: {
        findUnique: jest.fn().mockResolvedValue(user),
        count: jest.fn().mockResolvedValue(over.otherPlatformAdmins ?? 1),
        delete: jest.fn().mockResolvedValue({}),
      },
      societyMembership: { count: jest.fn().mockResolvedValue(over.otherAdmins ?? 1) },
      auditLog: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }), create: jest.fn().mockResolvedValue({}) },
      maintenanceRequest: { updateMany: jest.fn().mockResolvedValue({}), count: countFor('MaintenanceRequest') },
      notificationRecord: { deleteMany: jest.fn().mockResolvedValue({}), count: countFor('NotificationRecord') },
      directMessage: { deleteMany: jest.fn().mockResolvedValue({}), count: countFor('DirectMessage') },
    };
    for (const m of ['refreshToken', 'pushToken', 'passwordResetToken', 'conversationParticipant', 'expense', 'paymentSubmission', 'announcement', 'meeting', 'event', 'document', 'maintenanceRequestComment', 'forumTopic', 'forumReply', 'amenityBooking']) {
      const name = m.charAt(0).toUpperCase() + m.slice(1);
      tx[m] = { ...(tx[m] ?? {}), count: countFor(name) };
    }
    tx.auditLog.count = countFor('AuditLog');
    const prisma = { ...tx, $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    return { svc: new UserDeleteService(prisma as never), tx, prisma };
  }

  it('says 404 for an unknown account', async () => {
    const { svc } = build({ user: null });
    await expect(svc.preview(TARGET, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes an account that has only personal rows, and records who did it', async () => {
    const { svc, tx } = build({ counts: { 'NotificationRecord.userId': 4, 'RefreshToken.userId': 1 } });
    const res = await svc.deleteUser(TARGET, '  anil@example.com ', ACTOR);
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: TARGET } });
    expect(tx.notificationRecord.deleteMany).toHaveBeenCalledWith({ where: { userId: TARGET } });
    expect(tx.directMessage.deleteMany).toHaveBeenCalledWith({ where: { senderId: TARGET } });
    expect(tx.auditLog.deleteMany).toHaveBeenCalledWith({ where: { actorId: TARGET } });
    expect(tx.maintenanceRequest.updateMany).toHaveBeenCalledWith({ where: { assignedToId: TARGET }, data: { assignedToId: null } });
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ actorId: ACTOR, societyId: null, entityId: TARGET, action: 'USER_DELETED' });
    expect(res.removed).toEqual(expect.arrayContaining([{ label: 'notifications sent to them', count: 4 }]));
  });

  it('writes the audit record after the audit rows are cleared, never before', async () => {
    const { svc, tx } = build();
    await svc.deleteUser(TARGET, 'anil@example.com', ACTOR);
    const cleared = tx.auditLog.deleteMany.mock.invocationCallOrder[0];
    const written = tx.auditLog.create.mock.invocationCallOrder[0];
    expect(cleared).toBeLessThan(written);
  });

  it('refuses a wrong confirmation email and deletes nothing', async () => {
    const { svc, tx } = build();
    await expect(svc.deleteUser(TARGET, 'someone@else.com', ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.user.delete).not.toHaveBeenCalled();
    expect(tx.notificationRecord.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses to delete yourself', async () => {
    const { svc, tx } = build();
    await expect(svc.deleteUser(TARGET, 'anil@example.com', TARGET)).rejects.toThrow(/own account/);
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it('refuses while society records hang on the account, and names them', async () => {
    const { svc, tx } = build({ counts: { 'PaymentSubmission.userId': 3, 'ForumReply.authorId': 1 } });
    const p = await svc.preview(TARGET, ACTOR);
    expect(p.canDelete).toBe(false);
    expect(p.blockedBy).toEqual([
      { label: 'payments they submitted', count: 3 },
      { label: 'forum replies they wrote', count: 1 },
    ]);
    await expect(svc.deleteUser(TARGET, 'anil@example.com', ACTOR)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it('refuses to remove the only admin of a live society', async () => {
    const admin = {
      id: TARGET, firstName: 'Ria', lastName: 'S', email: 'ria@example.com', phone: null, isActive: true, isPlatformAdmin: false,
      memberships: [{ role: 'SOCIETY_ADMIN', status: 'ACTIVE', societyId: 's1', society: { name: 'Green', displayName: 'Green Valley', deletedAt: null } }],
    };
    const { svc, tx } = build({ user: admin, otherAdmins: 0 });
    const p = await svc.preview(TARGET, ACTOR);
    expect(p.canDelete).toBe(false);
    expect(p.reasons[0]).toMatch(/only admin of Green Valley/);
    await expect(svc.deleteUser(TARGET, 'ria@example.com', ACTOR)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it('allows removing an admin when another admin remains', async () => {
    const admin = {
      id: TARGET, firstName: 'Ria', lastName: 'S', email: 'ria@example.com', phone: null, isActive: true, isPlatformAdmin: false,
      memberships: [{ role: 'SOCIETY_ADMIN', status: 'ACTIVE', societyId: 's1', society: { name: 'Green', displayName: null, deletedAt: null } }],
    };
    const { svc } = build({ user: admin, otherAdmins: 1 });
    expect((await svc.preview(TARGET, ACTOR)).canDelete).toBe(true);
  });

  it('does not count an already-deleted society against the only-admin rule', async () => {
    const admin = {
      id: TARGET, firstName: 'Ria', lastName: 'S', email: 'ria@example.com', phone: null, isActive: true, isPlatformAdmin: false,
      memberships: [{ role: 'SOCIETY_ADMIN', status: 'ACTIVE', societyId: 's1', society: { name: 'Gone', displayName: null, deletedAt: new Date() } }],
    };
    const { svc } = build({ user: admin, otherAdmins: 0 });
    expect((await svc.preview(TARGET, ACTOR)).canDelete).toBe(true);
  });

  it('refuses to delete the last active platform admin', async () => {
    const pa = { id: TARGET, firstName: 'P', lastName: 'A', email: 'pa@example.com', phone: null, isActive: true, isPlatformAdmin: true, memberships: [] };
    const { svc } = build({ user: pa, otherPlatformAdmins: 0 });
    const p = await svc.preview(TARGET, ACTOR);
    expect(p.canDelete).toBe(false);
    expect(p.reasons).toEqual(['They are the only active platform admin.']);
  });

  it('turns a foreign-key failure into a plain message naming the step', async () => {
    const { svc, tx } = build();
    tx.user.delete.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('x', { code: 'P2003', clientVersion: '5', meta: { field_name: 'thing_fkey' } }));
    await expect(svc.deleteUser(TARGET, 'anil@example.com', ACTOR)).rejects.toThrow(/deleting the account.*thing_fkey/);
  });
});

describe('UserDeleteService — society admin scope', () => {
  const SOCIETY = 's1';
  const ACTOR = 'admin-1';
  const TARGET = 'user-1';
  const scope = { societyId: SOCIETY };

  const person = (over: Record<string, unknown> = {}) => ({
    id: TARGET, firstName: 'Anil', lastName: 'Reddy', email: 'anil@example.com', phone: '9000000001', isActive: true, isPlatformAdmin: false,
    memberships: [{ role: 'RESIDENT', status: 'INACTIVE', societyId: SOCIETY, society: { name: 'Green', displayName: null, deletedAt: null } }],
    ...over,
  });

  function build(user: unknown, otherAdmins = 1) {
    const zero = { count: jest.fn().mockResolvedValue(0) };
    const tx: Record<string, any> = {
      user: { findUnique: jest.fn().mockResolvedValue(user), count: jest.fn().mockResolvedValue(1), delete: jest.fn().mockResolvedValue({}) },
      societyMembership: { count: jest.fn().mockResolvedValue(otherAdmins) },
      auditLog: { ...zero, deleteMany: jest.fn().mockResolvedValue({}), create: jest.fn().mockResolvedValue({}) },
      maintenanceRequest: { ...zero, updateMany: jest.fn().mockResolvedValue({}) },
      notificationRecord: { ...zero, deleteMany: jest.fn().mockResolvedValue({}) },
      directMessage: { ...zero, deleteMany: jest.fn().mockResolvedValue({}) },
    };
    for (const m of ['refreshToken', 'pushToken', 'passwordResetToken', 'conversationParticipant', 'expense', 'paymentSubmission', 'announcement', 'meeting', 'event', 'document', 'maintenanceRequestComment', 'forumTopic', 'forumReply', 'amenityBooking']) tx[m] = zero;
    const prisma = { ...tx, $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)) };
    return { svc: new UserDeleteService(prisma as never), tx };
  }

  it('deletes a removed member of the admin’s own society', async () => {
    const { svc, tx } = build(person());
    await svc.deleteUser(TARGET, 'anil@example.com', ACTOR, scope);
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: TARGET } });
  });

  it('answers "not found" for someone who is not in this society — even if the account exists', async () => {
    const stranger = person({ memberships: [{ role: 'RESIDENT', status: 'ACTIVE', societyId: 'other', society: { name: 'Other', displayName: null, deletedAt: null } }] });
    const { svc, tx } = build(stranger);
    await expect(svc.preview(TARGET, ACTOR, scope)).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.deleteUser(TARGET, 'anil@example.com', ACTOR, scope)).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it('refuses a person who also belongs to another society, and does not name it', async () => {
    const both = person({
      memberships: [
        { role: 'RESIDENT', status: 'ACTIVE', societyId: SOCIETY, society: { name: 'Green', displayName: null, deletedAt: null } },
        { role: 'RESIDENT', status: 'ACTIVE', societyId: 'other', society: { name: 'Secret Heights', displayName: null, deletedAt: null } },
      ],
    });
    const { svc, tx } = build(both);
    const p = await svc.preview(TARGET, ACTOR, scope);
    expect(p.canDelete).toBe(false);
    expect(p.reasons.join(' ')).toMatch(/also belongs to another society/);
    expect(JSON.stringify(p)).not.toContain('Secret Heights');
    expect(p.memberships).toHaveLength(1);
    await expect(svc.deleteUser(TARGET, 'anil@example.com', ACTOR, scope)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it('never deletes a platform admin from a society', async () => {
    const { svc, tx } = build(person({ isPlatformAdmin: true }));
    const p = await svc.preview(TARGET, ACTOR, scope);
    expect(p.reasons.join(' ')).toMatch(/Platform admins cannot be deleted/);
    await expect(svc.deleteUser(TARGET, 'anil@example.com', ACTOR, scope)).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it('still protects the only admin of the society', async () => {
    const admin = person({ memberships: [{ role: 'SOCIETY_ADMIN', status: 'ACTIVE', societyId: SOCIETY, society: { name: 'Green', displayName: null, deletedAt: null } }] });
    const { svc } = build(admin, 0);
    expect((await svc.preview(TARGET, ACTOR, scope)).reasons.join(' ')).toMatch(/only admin of Green/);
  });

  it('keeps no personal details in the audit record, only a masked address, filed under the society', async () => {
    const { svc, tx } = build(person());
    await svc.deleteUser(TARGET, 'anil@example.com', ACTOR, scope);
    const row = tx.auditLog.create.mock.calls[0][0].data;
    expect(row).toMatchObject({ societyId: SOCIETY, actorId: ACTOR, action: 'USER_DELETED', oldValues: { email: 'an***@example.com' } });
    const text = JSON.stringify(row);
    expect(text).not.toContain('Anil');
    expect(text).not.toContain('Reddy');
    expect(text).not.toContain('9000000001');
    expect(text).not.toContain('anil@example.com');
  });

  it('still names the person in a platform admin’s record', async () => {
    const { svc, tx } = build(person());
    await svc.deleteUser(TARGET, 'anil@example.com', 'platform-1');
    expect(tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ societyId: null, oldValues: { email: 'anil@example.com', name: 'Anil Reddy' } });
  });
});
