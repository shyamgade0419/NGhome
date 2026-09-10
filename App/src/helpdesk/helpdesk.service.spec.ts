/**
 * Two-way helpdesk, and the access rule underneath it.
 *
 * GET /helpdesk/:id had no ownership check: any member could open any request
 * in the society by id and read the raiser's email and phone. The reply
 * thread is built on the same lookup, so these tests pin the rule for both.
 */

import { HelpdeskService } from './helpdesk.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const SOCIETY_ID = 'society-a';
const REQUEST_ID = 'req-1';
const OWNER = { id: 'resident-owner', currentRole: 'RESIDENT' };
const NEIGHBOUR = { id: 'resident-neighbour', currentRole: 'RESIDENT' };
const ADMIN = { id: 'admin-1', currentRole: 'SOCIETY_ADMIN' };
const STAFF = { id: 'staff-1', currentRole: 'SOCIETY_STAFF' };

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    societyId: SOCIETY_ID,
    residentId: OWNER.id,
    assignedToId: null,
    title: 'Kitchen tap leaking',
    status: 'OPEN',
    ...overrides,
  };
}

function makeService(request: unknown = makeRequest()) {
  const prisma = {
    maintenanceRequest: { findFirst: jest.fn().mockResolvedValue(request) },
    maintenanceRequestComment: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'c1', authorId: OWNER.id, body: 'Still dripping', author: {} },
        { id: 'c2', authorId: ADMIN.id, body: 'Plumber coming Friday', author: {} },
      ]),
      create: jest.fn().mockImplementation(({ data }: any) =>
        Promise.resolve({ id: 'new', ...data, author: {} }),
      ),
    },
    societyMembership: {
      findMany: jest.fn().mockResolvedValue([{ userId: ADMIN.id }]),
    },
  } as unknown as PrismaService;

  const notifications = {
    sendToUsers: jest.fn().mockResolvedValue(null),
    notifyQuietly: jest.fn(async (fn: () => Promise<unknown>) => { await fn(); }),
  } as unknown as NotificationsService;

  return { service: new HelpdeskService(prisma, notifications), prisma, notifications };
}

describe('HelpdeskService — who can open a request', () => {
  it('lets the resident who raised it open it', async () => {
    const { service } = makeService();
    await expect(service.findOne(SOCIETY_ID, REQUEST_ID, OWNER)).resolves.toBeDefined();
  });

  it('refuses a different resident — as not-found, so the id is not confirmed', async () => {
    const { service } = makeService();
    await expect(service.findOne(SOCIETY_ID, REQUEST_ID, NEIGHBOUR)).rejects.toThrow(NotFoundException);
  });

  it('lets staff open any request in the society', async () => {
    const { service } = makeService();
    await expect(service.findOne(SOCIETY_ID, REQUEST_ID, ADMIN)).resolves.toBeDefined();
    await expect(service.findOne(SOCIETY_ID, REQUEST_ID, STAFF)).resolves.toBeDefined();
  });

  it('lets a platform admin through regardless of current role', async () => {
    const { service } = makeService();
    await expect(
      service.findOne(SOCIETY_ID, REQUEST_ID, { id: 'p1', currentRole: 'RESIDENT', isPlatformAdmin: true }),
    ).resolves.toBeDefined();
  });
});

describe('HelpdeskService — the reply thread', () => {
  it('marks which lines came from the resident who raised it', async () => {
    const { service } = makeService();
    const thread = await service.listComments(SOCIETY_ID, REQUEST_ID, OWNER);

    expect(thread.map((c: any) => c.isFromResident)).toEqual([true, false]);
  });

  it('will not show a neighbour the conversation', async () => {
    const { service, prisma } = makeService();
    await expect(service.listComments(SOCIETY_ID, REQUEST_ID, NEIGHBOUR)).rejects.toThrow(NotFoundException);
    expect(prisma.maintenanceRequestComment.findMany).not.toHaveBeenCalled();
  });

  it('will not let a neighbour post into it', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.addComment(SOCIETY_ID, REQUEST_ID, NEIGHBOUR, { body: 'hello' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.maintenanceRequestComment.create).not.toHaveBeenCalled();
  });

  it('stores the author as the authenticated user, trimmed', async () => {
    const { service, prisma } = makeService();
    await service.addComment(SOCIETY_ID, REQUEST_ID, OWNER, { body: '  Still dripping  ' });

    const [createArg] = (prisma.maintenanceRequestComment.create as jest.Mock).mock.calls[0];
    expect(createArg.data).toEqual({ requestId: REQUEST_ID, authorId: OWNER.id, body: 'Still dripping' });
  });

  it('refuses a reply that is only whitespace', async () => {
    const { service } = makeService();
    await expect(
      service.addComment(SOCIETY_ID, REQUEST_ID, OWNER, { body: '   ' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses replies on a closed request', async () => {
    const { service } = makeService(makeRequest({ status: 'CLOSED' }));
    await expect(
      service.addComment(SOCIETY_ID, REQUEST_ID, OWNER, { body: 'It is back' }),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('HelpdeskService — who gets told about a reply', () => {
  it('tells the resident when staff reply', async () => {
    const { service, notifications } = makeService();
    await service.addComment(SOCIETY_ID, REQUEST_ID, ADMIN, { body: 'Plumber Friday' });

    const [, recipients] = (notifications.sendToUsers as jest.Mock).mock.calls[0];
    expect(recipients).toEqual([OWNER.id]);
  });

  it('tells the assigned staff member when the resident replies', async () => {
    const { service, notifications } = makeService(makeRequest({ assignedToId: STAFF.id }));
    await service.addComment(SOCIETY_ID, REQUEST_ID, OWNER, { body: 'Still dripping' });

    const [, recipients] = (notifications.sendToUsers as jest.Mock).mock.calls[0];
    expect(recipients).toEqual([STAFF.id]);
  });

  it('falls back to the society admins when nobody is assigned', async () => {
    const { service, notifications } = makeService();
    await service.addComment(SOCIETY_ID, REQUEST_ID, OWNER, { body: 'Still dripping' });

    const [, recipients] = (notifications.sendToUsers as jest.Mock).mock.calls[0];
    expect(recipients).toEqual([ADMIN.id]);
  });

  it('never notifies the author of their own reply', async () => {
    // An admin who is also the assignee replying to their own ticket thread.
    const { service, notifications } = makeService(
      makeRequest({ residentId: ADMIN.id, assignedToId: ADMIN.id }),
    );
    await service.addComment(SOCIETY_ID, REQUEST_ID, ADMIN, { body: 'note to self' });

    const [, recipients] = (notifications.sendToUsers as jest.Mock).mock.calls[0];
    expect(recipients).not.toContain(ADMIN.id);
  });
});
