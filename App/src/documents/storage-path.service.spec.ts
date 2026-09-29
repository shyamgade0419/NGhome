/**
 * StoragePathService is the only place SFTP paths are built, so it is also
 * the only place traversal can be stopped. Every segment is validated; the
 * folder never comes from user input.
 *
 * The society segment of every path is now that society's storage slug
 * (Society.storageSlug) once one exists, generated lazily on first use and
 * persisted forever after — see the "storage slug" describe blocks below.
 * Most other tests here don't care about that at all: the default mock
 * echoes the queried id back as its own slug, so every path comes out
 * exactly as it did before the slug existed, and this file stays focused on
 * what it always tested (folder layout, traversal, category mapping).
 */

import { BadRequestException } from '@nestjs/common';
import { Prisma as PrismaNS } from '@prisma/client';
import { StoragePathService } from './storage-path.service';
import { SftpStorageService } from './sftp-storage.service';
import { PrismaService } from '../prisma/prisma.service';

/** society.findUnique keyed by id, defaulting to "echo the id back as its own
 *  slug" so callers that don't care about slugs see the pre-slug behaviour. */
function makePrisma(overrides: Record<string, { name: string; storageSlug: string | null } | null> = {}) {
  const update = jest.fn().mockImplementation(({ where, data }: any) => {
    if (overrides[where.id]) overrides[where.id] = { ...overrides[where.id]!, ...data };
    return Promise.resolve({ id: where.id, ...data });
  });
  const findUnique = jest.fn().mockImplementation(({ where }: any) => {
    if (where.id in overrides) {
      const row = overrides[where.id];
      return Promise.resolve(row ? { name: row.name, storageSlug: row.storageSlug } : null);
    }
    return Promise.resolve({ name: where.id, storageSlug: where.id });
  });
  return { society: { findUnique, update } } as unknown as PrismaService;
}

function pathsWithBase(base = '/ng-home-documents', prisma = makePrisma()) {
  const storage = { getBasePath: () => base } as unknown as SftpStorageService;
  return new StoragePathService(storage, prisma);
}

describe('StoragePathService — layout', () => {
  const paths = pathsWithBase();

  it('society-owned: society-1 + notices', async () => {
    expect(await paths.societyFile('society-1', 'notices', 'file')).toBe(
      '/ng-home-documents/society-1/society/notices/file',
    );
  });

  it('flat-owned: society-1 + flat-10 + documents', async () => {
    expect(await paths.residentFile('society-1', 'flat-10', 'documents', 'file')).toBe(
      '/ng-home-documents/society-1/residents/flat-10/documents/file',
    );
  });

  it('payment proof: society-1 + flat-10', async () => {
    expect(await paths.paymentProof('society-1', 'flat-10', 'file')).toBe(
      '/ng-home-documents/society-1/residents/flat-10/payments/file',
    );
  });

  it('accepts real UUID ids', async () => {
    const society = '3f2b8c1e-9d4a-4e7b-8a1c-2f6d9e0b5a7c';
    const flat = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
    expect(await paths.residentFile(society, flat, 'profile', 'x.jpg')).toBe(
      `/ng-home-documents/${society}/residents/${flat}/profile/x.jpg`,
    );
  });

  it('does not double the slash when the base path ends in one', async () => {
    expect(await pathsWithBase('/ng-home-documents/').societyFile('s1', 'images', 'a.png')).toBe(
      '/ng-home-documents/s1/society/images/a.png',
    );
  });

  it('follows whatever base path the deployment configures', async () => {
    expect(await pathsWithBase('/home/novagade/nghome-storage').paymentProof('s1', 'f1', 'r.pdf')).toBe(
      '/home/novagade/nghome-storage/s1/residents/f1/payments/r.pdf',
    );
  });
});

describe('StoragePathService — document category → folder', () => {
  const paths = pathsWithBase();
  const society = (category: string | null | undefined) =>
    paths.documentFile('s1', null, category, 'f.pdf');
  const resident = (category: string | null | undefined) =>
    paths.documentFile('s1', 'flat-1', category, 'f.pdf');

  it('puts a document without a flat under the society', async () => {
    expect(await society('notices')).toBe('/ng-home-documents/s1/society/notices/f.pdf');
  });

  it('puts a document with a flat under that flat', async () => {
    expect(await resident('documents')).toBe('/ng-home-documents/s1/residents/flat-1/documents/f.pdf');
  });

  it("maps web's NOTICE to notices, case-insensitively", async () => {
    expect(await society('NOTICE')).toBe('/ng-home-documents/s1/society/notices/f.pdf');
  });

  it.each(['MINUTES', 'FINANCIAL', 'LEGAL', 'MAINTENANCE', 'OTHER'])(
    "sends web's %s to documents",
    async (category) => {
      expect(await society(category)).toBe('/ng-home-documents/s1/society/documents/f.pdf');
    },
  );

  it('sends free text typed on mobile to documents', async () => {
    expect(await resident('Rent agreement 2026')).toBe(
      '/ng-home-documents/s1/residents/flat-1/documents/f.pdf',
    );
  });

  it('defaults to documents when there is no category', async () => {
    expect(await society(undefined)).toBe('/ng-home-documents/s1/society/documents/f.pdf');
    expect(await resident(null)).toBe('/ng-home-documents/s1/residents/flat-1/documents/f.pdf');
  });

  it('never turns a traversal-shaped category into a directory', async () => {
    for (const hostile of ['../../other-society', '../../../etc', '..\\..\\x', '/etc/passwd']) {
      expect(await society(hostile)).toBe('/ng-home-documents/s1/society/documents/f.pdf');
      expect(await resident(hostile)).toBe('/ng-home-documents/s1/residents/flat-1/documents/f.pdf');
    }
  });

  it('keeps each owner to its own folders', async () => {
    // "screenshots" is a flat folder, not a society one; "images" the reverse.
    expect(await society('screenshots')).toBe('/ng-home-documents/s1/society/documents/f.pdf');
    expect(await resident('images')).toBe('/ng-home-documents/s1/residents/flat-1/documents/f.pdf');
    expect(await resident('screenshot')).toBe('/ng-home-documents/s1/residents/flat-1/screenshots/f.pdf');
  });
});

describe('StoragePathService — traversal', () => {
  const paths = pathsWithBase();
  const hostile = ['../', '../../', '..', '.', 'foo/bar', 'foo\\bar', '/etc', 'C:\\Windows', '', ' ', 'a b'];

  it.each(hostile)('rejects %j as a society id', async (value) => {
    await expect(paths.societyFile(value, 'documents', 'f.pdf')).rejects.toThrow(BadRequestException);
  });

  it.each(hostile)('rejects %j as a flat id', async (value) => {
    await expect(paths.residentFile('s1', value, 'documents', 'f.pdf')).rejects.toThrow(BadRequestException);
  });

  it.each(['../x.pdf', 'a/b.pdf', 'a\\b.pdf', '..', '.', '.hidden', '/abs.pdf', ''])(
    'rejects %j as a file name',
    async (value) => {
      await expect(paths.societyFile('s1', 'documents', value)).rejects.toThrow(BadRequestException);
    },
  );

  it('rejects a folder outside the allowlist, even when forced past the type', async () => {
    await expect(paths.societyFile('s1', '../x' as never, 'f.pdf')).rejects.toThrow(BadRequestException);
    await expect(
      paths.residentFile('s1', 'f1', 'payments/../../other' as never, 'f.pdf'),
    ).rejects.toThrow(BadRequestException);
  });

  it('does not echo the rejected value back in the error', async () => {
    await expect(paths.societyFile('../../evil', 'documents', 'f.pdf')).rejects.toThrow(
      'Invalid society for file storage.',
    );
  });
});

describe('StoragePathService.isSocietyKey', () => {
  const paths = pathsWithBase();

  it.each([
    '/ng-home-documents/s1/society/notices/a.pdf',
    '/ng-home-documents/s1/residents/flat-1/payments/r.jpg',
    // the layout used before the reorganisation
    '/ng-home-documents/s1/3f2b8c1e-old.pdf',
    '/ng-home-documents/s1/payment-proofs/3f2b8c1e-old.jpg',
  ])('accepts %s for s1', async (key) => {
    expect(await paths.isSocietyKey('s1', key)).toBe(true);
  });

  it.each([
    '/ng-home-documents/s2/society/notices/a.pdf', // another society
    '/ng-home-documents/s10/society/notices/a.pdf', // shares a prefix, not the folder
    '/ng-home-documents/s1', // the folder itself
    '/ng-home-documents/s1/', // nothing after the folder
    '/ng-home-documents/s1/../s2/a.pdf',
    '/ng-home-documents/s1/society/../../s2/a.pdf',
    '/ng-home-documents/s1/./a.pdf',
    '/ng-home-documents/s1//a.pdf',
    '/ng-home-documents/s1/a\\..\\..\\b.pdf',
    '/etc/passwd',
    'https://example.com/file.pdf',
    '',
  ])('refuses %j for s1', async (key) => {
    expect(await paths.isSocietyKey('s1', key)).toBe(false);
  });

  it('refuses when the society id itself is unsafe', async () => {
    expect(await paths.isSocietyKey('..', '/ng-home-documents/../a.pdf')).toBe(false);
    expect(await paths.isSocietyKey('', '/ng-home-documents//a.pdf')).toBe(false);
  });

  it('accepts a key under the storage slug once one exists, alongside the raw id', async () => {
    const prisma = makePrisma({ s1: { name: 'Chaitanya Classic 3', storageSlug: 'chaitanya-classic-3-a1b2c3d4' } });
    const paths = pathsWithBase('/ng-home-documents', prisma);

    expect(await paths.isSocietyKey('s1', '/ng-home-documents/chaitanya-classic-3-a1b2c3d4/society/notices/a.pdf')).toBe(
      true,
    );
    // Old files, uploaded before this society had a slug, stay reachable.
    expect(await paths.isSocietyKey('s1', '/ng-home-documents/s1/society/notices/a.pdf')).toBe(true);
  });

  it('never accepts another society\'s slug', async () => {
    const prisma = makePrisma({
      s1: { name: 'Society One', storageSlug: 'society-one-aaaaaaaa' },
      s2: { name: 'Society Two', storageSlug: 'society-two-bbbbbbbb' },
    });
    const paths = pathsWithBase('/ng-home-documents', prisma);

    expect(await paths.isSocietyKey('s1', '/ng-home-documents/society-two-bbbbbbbb/society/notices/a.pdf')).toBe(
      false,
    );
  });
});

describe('StoragePathService — storage slug', () => {
  it('uses the existing slug without writing anything', async () => {
    const prisma = makePrisma({ s1: { name: 'Chaitanya Classic 3', storageSlug: 'chaitanya-classic-3-a1b2c3d4' } });
    const paths = pathsWithBase('/ng-home-documents', prisma);

    const path = await paths.societyFile('s1', 'notices', 'f.pdf');

    expect(path).toBe('/ng-home-documents/chaitanya-classic-3-a1b2c3d4/society/notices/f.pdf');
    expect((prisma.society.update as jest.Mock)).not.toHaveBeenCalled();
  });

  it('generates and persists a slug the first time a society with none uploads', async () => {
    // A realistic UUID matters here: the 8-char suffix comes from the id
    // itself, and a short test id like "s1" doesn't exercise that shape.
    const id = '3f2b8c1e-9d4a-4e7b-8a1c-2f6d9e0b5a7c';
    const prisma = makePrisma({ [id]: { name: 'Chaitanya Classic 3', storageSlug: null } });
    const paths = pathsWithBase('/ng-home-documents', prisma);

    const path = await paths.societyFile(id, 'notices', 'f.pdf');

    expect(path).toMatch(/^\/ng-home-documents\/chaitanya-classic-3-3f2b8c1e\/society\/notices\/f\.pdf$/);
    expect((prisma.society.update as jest.Mock)).toHaveBeenCalledWith({
      where: { id },
      data: { storageSlug: 'chaitanya-classic-3-3f2b8c1e' },
    });
  });

  it('never recomputes the slug from a later name change — only the stored value is read', async () => {
    const prisma = makePrisma({ s1: { name: 'Renamed Society', storageSlug: 'original-name-a1b2c3d4' } });
    const paths = pathsWithBase('/ng-home-documents', prisma);

    const path = await paths.residentFile('s1', 'flat-1', 'documents', 'f.pdf');

    expect(path).toBe('/ng-home-documents/original-name-a1b2c3d4/residents/flat-1/documents/f.pdf');
  });

  it('slugifies a name with spaces, punctuation and mixed case', async () => {
    const id = '3f2b8c1e-9d4a-4e7b-8a1c-2f6d9e0b5a7c';
    const prisma = makePrisma({ [id]: { name: "St. Mary's  Co-op   (Phase 2)", storageSlug: null } });
    const paths = pathsWithBase('/ng-home-documents', prisma);

    const path = await paths.societyFile(id, 'notices', 'f.pdf');

    expect(path).toBe('/ng-home-documents/st-mary-s-co-op-phase-2-3f2b8c1e/society/notices/f.pdf');
  });

  it('widens the slug on a unique-constraint collision instead of failing the upload', async () => {
    const id = '3f2b8c1e-9d4a-4e7b-8a1c-2f6d9e0b5a7c';
    const prisma = makePrisma({ [id]: { name: 'Chaitanya Classic 3', storageSlug: null } });
    const conflict = Object.assign(new PrismaNS.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.0.0',
    }));
    (prisma.society.update as jest.Mock).mockRejectedValueOnce(conflict).mockImplementationOnce(({ where, data }: any) => {
      return Promise.resolve({ id: where.id, ...data });
    });
    const paths = pathsWithBase('/ng-home-documents', prisma);

    const path = await paths.societyFile(id, 'notices', 'f.pdf');

    expect(path).toMatch(/^\/ng-home-documents\/chaitanya-classic-3-3f2b8c1e-[0-9a-f]{4}\/society\/notices\/f\.pdf$/);
    expect(prisma.society.update).toHaveBeenCalledTimes(2);
  });

  it('rejects a society id that does not exist, rather than writing an undefined-name slug', async () => {
    const prisma = makePrisma({ ghost: null });
    const paths = pathsWithBase('/ng-home-documents', prisma);

    await expect(paths.societyFile('ghost', 'notices', 'f.pdf')).rejects.toThrow('Invalid society for file storage.');
  });
});

describe('StoragePathService.storedFileName', () => {
  const paths = pathsWithBase();

  it('is a UUID followed by the sanitised original name', () => {
    expect(paths.storedFileName('Maintenance Receipt.pdf')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-Maintenance_Receipt\.pdf$/,
    );
  });

  it('is unique for two uploads with the same name', () => {
    expect(paths.storedFileName('a.pdf')).not.toBe(paths.storedFileName('a.pdf'));
  });

  it('always produces a name the path methods accept — even from a hostile original', async () => {
    for (const original of ['../../../etc/passwd', '..\\..\\win.ini', '.htaccess', '///']) {
      const name = paths.storedFileName(original);
      await expect(paths.societyFile('s1', 'documents', name)).resolves.toBeDefined();
    }
  });
});
