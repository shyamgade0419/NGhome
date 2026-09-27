/**
 * Platform console: storage per society, the on-demand SFTP check, and
 * platform-admin management.
 */

import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PlatformService, fileKind } from './platform.service';
import { PrismaService } from '../prisma/prisma.service';
import { SftpStorageService } from '../documents/sftp-storage.service';

const ACTOR = 'admin-1';

function makeStorage(check: unknown = { ok: true, home: '/home/x', base: 'apartment-management' }) {
  return {
    getBasePath: jest.fn().mockReturnValue('apartment-management'),
    checkStorage: jest.fn().mockResolvedValue(check),
  } as unknown as SftpStorageService;
}

describe('fileKind', () => {
  it.each([
    ['image/jpeg', 'images'],
    ['image/heic', 'images'],
    ['application/pdf', 'pdf'],
    ['application/msword', 'office'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'office'],
    ['application/vnd.ms-excel', 'office'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'office'],
    ['text/csv', 'office'],
    ['text/plain', 'other'],
  ])('%s -> %s', (mime, kind) => {
    expect(fileKind(mime)).toBe(kind);
  });
});

describe('PlatformService.getStorageOverview', () => {
  function prismaWith() {
    return {
      society: {
        findMany: jest.fn().mockResolvedValue([
          { id: 's1', name: 'Alpha', displayName: null },
          { id: 's2', name: 'Beta', displayName: 'Beta Heights' },
          { id: 's3', name: 'Empty', displayName: null },
        ]),
      },
      document: {
        groupBy: jest
          .fn()
          .mockResolvedValueOnce([
            { societyId: 's1', _count: { _all: 3 }, _sum: { fileSize: 3000 } },
            { societyId: 's2', _count: { _all: 1 }, _sum: { fileSize: 9000 } },
            // A deleted society's files must not inflate the total.
            { societyId: 'gone', _count: { _all: 5 }, _sum: { fileSize: 99999 } },
          ])
          .mockResolvedValueOnce([
            { mimeType: 'image/jpeg', _count: { _all: 2 }, _sum: { fileSize: 8000 } },
            { mimeType: 'image/png', _count: { _all: 1 }, _sum: { fileSize: 1000 } },
            { mimeType: 'application/pdf', _count: { _all: 1 }, _sum: { fileSize: 3000 } },
          ]),
      },
    } as unknown as PrismaService;
  }

  it('reports files and bytes per society, largest first, including societies with none', async () => {
    const out = await new PlatformService(prismaWith(), makeStorage()).getStorageOverview();

    expect(out.societies.map((s) => [s.name, s.files, s.bytes])).toEqual([
      ['Beta Heights', 1, 9000],
      ['Alpha', 3, 3000],
      ['Empty', 0, 0],
    ]);
  });

  it('totals only live societies', async () => {
    const out = await new PlatformService(prismaWith(), makeStorage()).getStorageOverview();

    expect(out.totalFiles).toBe(4);
    expect(out.totalBytes).toBe(12000);
  });

  it('breaks usage down by file type', async () => {
    const out = await new PlatformService(prismaWith(), makeStorage()).getStorageOverview();

    expect(out.byType.images).toEqual({ files: 3, bytes: 9000 });
    expect(out.byType.pdf).toEqual({ files: 1, bytes: 3000 });
    expect(out.byType.other).toEqual({ files: 0, bytes: 0 });
  });

  it('counts only active files actually stored on SFTP, not link documents', async () => {
    const prisma = prismaWith();
    await new PlatformService(prisma, makeStorage()).getStorageOverview();

    const [args] = (prisma.document.groupBy as jest.Mock).mock.calls[0];
    expect(args.where).toEqual({ storageProvider: 'sftp', isActive: true });
  });

  it('reports the configured base path, and never opens an SFTP connection', async () => {
    const storage = makeStorage();
    const out = await new PlatformService(prismaWith(), storage).getStorageOverview();

    expect(out.basePath).toBe('apartment-management');
    expect(storage.checkStorage).not.toHaveBeenCalled();
  });
});

describe('PlatformService.checkStorageConnection', () => {
  it('returns the base and home when the write check passes', async () => {
    const out = await new PlatformService({} as PrismaService, makeStorage()).checkStorageConnection();
    expect(out).toEqual({ ok: true, base: 'apartment-management', home: '/home/x' });
  });

  it('returns the reason when it fails', async () => {
    const storage = makeStorage({ ok: false, reason: 'could not log in — timeout' });
    const out = await new PlatformService({} as PrismaService, storage).checkStorageConnection();
    expect(out).toEqual({ ok: false, reason: 'could not log in — timeout' });
  });
});

describe('PlatformService admins', () => {
  function adminPrisma(target: unknown = { id: 'admin-2', isActive: true }) {
    return {
      user: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(target),
        update: jest.fn().mockResolvedValue({ id: 'admin-2', isActive: false }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
  }

  it('lists only platform admins and never selects passwordHash', async () => {
    const prisma = adminPrisma();
    await new PlatformService(prisma, makeStorage()).listAdmins();

    const [args] = (prisma.user.findMany as jest.Mock).mock.calls[0];
    expect(args.where).toMatchObject({ isPlatformAdmin: true, deletedAt: null });
    expect(args.select.passwordHash).toBeUndefined();
  });

  it('deactivates another platform admin and records who did it', async () => {
    const prisma = adminPrisma();
    await new PlatformService(prisma, makeStorage()).setAdminActive('admin-2', false, ACTOR);

    expect((prisma.user.update as jest.Mock).mock.calls[0][0]).toMatchObject({
      where: { id: 'admin-2' },
      data: { isActive: false },
    });
    const [audit] = (prisma.auditLog.create as jest.Mock).mock.calls[0];
    expect(audit.data).toMatchObject({
      actorId: ACTOR,
      action: 'USER_DEACTIVATED',
      entityId: 'admin-2',
      oldValues: { isActive: true },
    });
  });

  it('labels a reactivation as such', async () => {
    const prisma = adminPrisma({ id: 'admin-2', isActive: false });
    await new PlatformService(prisma, makeStorage()).setAdminActive('admin-2', true, ACTOR);

    const [audit] = (prisma.auditLog.create as jest.Mock).mock.calls[0];
    expect(audit.data.action).toBe('USER_MODIFIED');
    expect(audit.data.newValues).toMatchObject({ action: 'PLATFORM_ADMIN_REACTIVATED' });
  });

  it('refuses to change your own access — so an active platform admin always remains', async () => {
    const prisma = adminPrisma();
    await expect(new PlatformService(prisma, makeStorage()).setAdminActive(ACTOR, false, ACTOR)).rejects.toThrow(
      BadRequestException,
    );
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('refuses a user who is not a platform admin — this cannot be used to deactivate a resident', async () => {
    const prisma = adminPrisma(null);
    await expect(new PlatformService(prisma, makeStorage()).setAdminActive('resident-1', false, ACTOR)).rejects.toThrow(
      NotFoundException,
    );
    const [args] = (prisma.user.findFirst as jest.Mock).mock.calls[0];
    expect(args.where).toMatchObject({ isPlatformAdmin: true });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
