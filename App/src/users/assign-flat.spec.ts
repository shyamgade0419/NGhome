import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SystemRole } from '@prisma/client';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';

const SOCIETY_ID = 'society-1';
const USER_ID = 'user-1';
const FLAT_ID = 'flat-1';
const ACTOR_ID = 'admin-1';

function build(opts: { flat?: unknown; memberships?: object[] } = {}) {
  const update = jest.fn().mockImplementation(async ({ data }) => ({ id: 'm1', ...data }));
  const auditCreate = jest.fn().mockResolvedValue({});
  const tx = { societyMembership: { update }, auditLog: { create: auditCreate } };
  const prisma = {
    flat: { findFirst: jest.fn().mockResolvedValue('flat' in opts ? opts.flat : { id: FLAT_ID, societyId: SOCIETY_ID }) },
    societyMembership: { findMany: jest.fn().mockResolvedValue(opts.memberships ?? []) },
    $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;
  return { service: new UsersService(prisma), prisma, update, auditCreate };
}

const admin = { id: 'm1', societyId: SOCIETY_ID, userId: USER_ID, role: SystemRole.SOCIETY_ADMIN, flatId: null, status: 'ACTIVE' };

describe('UsersService.assignFlat', () => {
  it('gives an admin with no flat a flat, by updating their one membership row', async () => {
    const { service, update } = build({ memberships: [admin] });
    const out: any = await service.assignFlat(SOCIETY_ID, USER_ID, FLAT_ID, ACTOR_ID);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { flatId: FLAT_ID } });
    expect(out.flatId).toBe(FLAT_ID);
  });

  it('works for the other non-resident roles too', async () => {
    for (const role of [SystemRole.COMMITTEE_MEMBER, SystemRole.SOCIETY_ACCOUNTANT, SystemRole.SOCIETY_STAFF]) {
      const { service, update } = build({ memberships: [{ ...admin, role }] });
      await service.assignFlat(SOCIETY_ID, USER_ID, FLAT_ID, ACTOR_ID);
      expect(update).toHaveBeenCalledTimes(1);
    }
  });

  it('never creates a second membership row, and keeps the role as it was', async () => {
    const { service, update } = build({ memberships: [admin] });
    await service.assignFlat(SOCIETY_ID, USER_ID, FLAT_ID, ACTOR_ID);
    expect(update.mock.calls[0][0].data).toEqual({ flatId: FLAT_ID }); // only the flat; role untouched
  });

  it('refuses a flat that belongs to another society', async () => {
    const { service, prisma, update } = build({ flat: null, memberships: [admin] });
    await expect(service.assignFlat(SOCIETY_ID, USER_ID, FLAT_ID, ACTOR_ID)).rejects.toThrow(NotFoundException);
    expect(prisma.flat.findFirst).toHaveBeenCalledWith({ where: { id: FLAT_ID, societyId: SOCIETY_ID } });
    expect(update).not.toHaveBeenCalled();
  });

  it('refuses someone who is not an active member of this society', async () => {
    const { service, update } = build({ memberships: [] });
    await expect(service.assignFlat(SOCIETY_ID, USER_ID, FLAT_ID, ACTOR_ID)).rejects.toThrow(NotFoundException);
    expect(update).not.toHaveBeenCalled();
  });

  it('only looks at active memberships in this society', async () => {
    const { service, prisma } = build({ memberships: [admin] });
    await service.assignFlat(SOCIETY_ID, USER_ID, FLAT_ID, ACTOR_ID);
    expect(prisma.societyMembership.findMany).toHaveBeenCalledWith({
      where: { societyId: SOCIETY_ID, userId: USER_ID, status: 'ACTIVE' },
    });
  });

  it('will not guess between several memberships', async () => {
    const { service, update } = build({ memberships: [admin, { ...admin, id: 'm2', flatId: 'flat-9' }] });
    await expect(service.assignFlat(SOCIETY_ID, USER_ID, FLAT_ID, ACTOR_ID)).rejects.toThrow(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });

  it('does not move a resident who already has a flat', async () => {
    const resident = { ...admin, role: SystemRole.RESIDENT, flatId: 'flat-9' };
    const { service, update } = build({ memberships: [resident] });
    await expect(service.assignFlat(SOCIETY_ID, USER_ID, FLAT_ID, ACTOR_ID)).rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('is a no-op, not an error, when the member is already on that flat', async () => {
    const { service, update } = build({ memberships: [{ ...admin, flatId: FLAT_ID }] });
    await expect(service.assignFlat(SOCIETY_ID, USER_ID, FLAT_ID, ACTOR_ID)).resolves.toMatchObject({ flatId: FLAT_ID });
    expect(update).not.toHaveBeenCalled();
  });

  it('lets an admin who already has a flat be moved to another', async () => {
    const { service, update } = build({ memberships: [{ ...admin, flatId: 'flat-9' }] });
    await service.assignFlat(SOCIETY_ID, USER_ID, FLAT_ID, ACTOR_ID);
    expect(update).toHaveBeenCalledWith({ where: { id: 'm1' }, data: { flatId: FLAT_ID } });
  });

  it('records who did it, with the old and new flat, in the same transaction', async () => {
    const { service, auditCreate, prisma } = build({ memberships: [{ ...admin, flatId: 'flat-9' }] });
    await service.assignFlat(SOCIETY_ID, USER_ID, FLAT_ID, ACTOR_ID);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const data = auditCreate.mock.calls[0][0].data;
    expect(data).toMatchObject({ societyId: SOCIETY_ID, actorId: ACTOR_ID, entityType: 'SocietyMembership', entityId: 'm1' });
    expect(data.oldValues).toEqual({ flatId: 'flat-9' });
    expect(data.newValues).toMatchObject({ flatId: FLAT_ID, action: 'FLAT_ASSIGNED' });
  });
});
