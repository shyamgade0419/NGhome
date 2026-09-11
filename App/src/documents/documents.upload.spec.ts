/**
 * Uploads now land in a per-society, per-flat layout. The layout must follow
 * the access rules, not the request: a resident's file goes under the flat in
 * their signed token whatever the body says, and stays FLAT_PRIVATE.
 */

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DocumentAccessLevel } from '@prisma/client';
import { DocumentsService } from './documents.service';
import { StoragePathService } from './storage-path.service';
import { SftpStorageService } from './sftp-storage.service';
import { PrismaService } from '../prisma/prisma.service';

const SOCIETY = 'society-1';
const MY_FLAT = 'flat-10';
const OTHER_FLAT = 'flat-99';
const BASE = '/ng-home-documents';
const UUID_PREFIX = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const PDF = {
  originalname: 'Aadhar Card.pdf',
  size: 2048,
  mimetype: 'application/pdf',
  buffer: Buffer.from('%PDF'),
};

function setup(opts: { flatInSociety?: boolean; createFails?: boolean } = {}) {
  const storage = {
    getBasePath: jest.fn().mockReturnValue(BASE),
    upload: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    download: jest.fn().mockResolvedValue(Buffer.from('bytes')),
  } as unknown as SftpStorageService;

  const create = opts.createFails
    ? jest.fn().mockRejectedValue(new Error('database unavailable'))
    : jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'doc-1', ...data }),
      );

  const prisma = {
    flat: {
      findFirst: jest
        .fn()
        .mockResolvedValue(opts.flatInSociety === false ? null : { id: OTHER_FLAT, societyId: SOCIETY }),
    },
    document: {
      create,
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'doc-1', storageProvider: 'sftp', fileKey: `${BASE}/${SOCIETY}/x.pdf`, ...data }),
      ),
    },
  } as unknown as PrismaService;

  const service = new DocumentsService(prisma, storage, new StoragePathService(storage));
  return { service, storage, prisma, create };
}

describe('DocumentsService.upload — resident', () => {
  it("stores under the resident's own flat, ignoring a different flatId in the request", async () => {
    const { service, storage, create } = setup();
    await service.upload(SOCIETY, 'user-1', true, MY_FLAT, PDF, {
      title: 'ID proof',
      flatId: OTHER_FLAT, // attempted: someone else's flat
    });

    const [, remotePath] = (storage.upload as jest.Mock).mock.calls[0];
    expect(remotePath).toMatch(
      new RegExp(`^${BASE}/${SOCIETY}/residents/${MY_FLAT}/documents/${UUID_PREFIX}-Aadhar_Card\\.pdf$`),
    );
    expect(remotePath).not.toContain(OTHER_FLAT);

    const [{ data }] = create.mock.calls[0];
    expect(data.flatId).toBe(MY_FLAT);
  });

  it('stays FLAT_PRIVATE even when the request asks for a wider access level', async () => {
    const { service, create } = setup();
    await service.upload(SOCIETY, 'user-1', true, MY_FLAT, PDF, {
      title: 'ID proof',
      accessLevel: DocumentAccessLevel.PUBLIC,
    });

    const [{ data }] = create.mock.calls[0];
    expect(data.accessLevel).toBe(DocumentAccessLevel.FLAT_PRIVATE);
  });

  it('refuses a resident with no flat, and writes nothing', async () => {
    const { service, storage, create } = setup();
    await expect(
      service.upload(SOCIETY, 'user-1', true, undefined, PDF, { title: 'x', flatId: OTHER_FLAT }),
    ).rejects.toThrow(ForbiddenException);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the original filename for display and the full path as the storage key', async () => {
    const { service, storage, create } = setup();
    await service.upload(SOCIETY, 'user-1', true, MY_FLAT, PDF, { title: 'ID proof' });

    const [, remotePath] = (storage.upload as jest.Mock).mock.calls[0];
    const [{ data }] = create.mock.calls[0];
    expect(data.fileName).toBe('Aadhar Card.pdf');
    expect(data.fileKey).toBe(remotePath);
  });
});

describe('DocumentsService.upload — staff', () => {
  it('stores a society-wide document under the society, not a flat', async () => {
    const { service, storage, create } = setup();
    await service.upload(SOCIETY, 'admin-1', false, undefined, PDF, {
      title: 'AGM notice',
      category: 'NOTICE',
      accessLevel: DocumentAccessLevel.RESIDENTS_ONLY,
    });

    const [, remotePath] = (storage.upload as jest.Mock).mock.calls[0];
    expect(remotePath).toMatch(new RegExp(`^${BASE}/${SOCIETY}/society/notices/${UUID_PREFIX}-`));
    const [{ data }] = create.mock.calls[0];
    expect(data.flatId).toBeNull();
    // The typed category is kept as-is in the database; only the folder is derived.
    expect(data.category).toBe('NOTICE');
  });

  it('stores a FLAT_PRIVATE document under the flat it names, once that flat is confirmed', async () => {
    const { service, storage, prisma } = setup();
    await service.upload(SOCIETY, 'admin-1', false, undefined, PDF, {
      title: 'Sale deed',
      accessLevel: DocumentAccessLevel.FLAT_PRIVATE,
      flatId: OTHER_FLAT,
    });

    expect(prisma.flat.findFirst).toHaveBeenCalledWith({ where: { id: OTHER_FLAT, societyId: SOCIETY } });
    const [, remotePath] = (storage.upload as jest.Mock).mock.calls[0];
    expect(remotePath).toContain(`/${SOCIETY}/residents/${OTHER_FLAT}/documents/`);
  });

  it('refuses a flat from another society, and writes nothing', async () => {
    const { service, storage } = setup({ flatInSociety: false });
    await expect(
      service.upload(SOCIETY, 'admin-1', false, undefined, PDF, {
        title: 'x',
        accessLevel: DocumentAccessLevel.FLAT_PRIVATE,
        flatId: 'flat-in-another-society',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(storage.upload).not.toHaveBeenCalled();
  });
});

describe('DocumentsService.upload — consistency', () => {
  it('removes the uploaded file when the database write fails, and still reports the failure', async () => {
    const { service, storage } = setup({ createFails: true });

    await expect(
      service.upload(SOCIETY, 'user-1', true, MY_FLAT, PDF, { title: 'ID proof' }),
    ).rejects.toThrow('database unavailable');

    const [, uploadedPath] = (storage.upload as jest.Mock).mock.calls[0];
    expect(storage.remove).toHaveBeenCalledWith(uploadedPath);
  });
});

describe('DocumentsService — files stored under the old layout', () => {
  it.each([
    `${BASE}/${SOCIETY}/3f2b8c1e-old-upload.pdf`,
    `${BASE}/${SOCIETY}/payment-proofs/3f2b8c1e-old-receipt.jpg`,
  ])('downloads %s from exactly where it was stored', async (legacyKey) => {
    // No migration moves old files; they must stay reachable by their fileKey.
    const { service, storage, prisma } = setup();
    (prisma.document.findFirst as jest.Mock).mockResolvedValue({
      id: 'doc-old',
      storageProvider: 'sftp',
      fileKey: legacyKey,
      fileName: 'old.pdf',
      mimeType: 'application/pdf',
    });

    await service.getFileBuffer(SOCIETY, 'doc-old', false, undefined);
    expect(storage.download).toHaveBeenCalledWith(legacyKey);
  });
});

describe('DocumentsService — a stored path is never taken from the client', () => {
  it("records a link document as a link, even when the body claims it is 'sftp'", async () => {
    const { service, create } = setup();
    await service.create(SOCIETY, 'admin-1', false, undefined, {
      title: 'x',
      fileName: 'x.pdf',
      fileKey: 'https://drive.example.com/their-receipt.jpg',
      fileSize: 0,
      mimeType: 'application/pdf',
      storageProvider: 'sftp',
    });

    const [{ data }] = create.mock.calls[0];
    expect(data.storageProvider).toBe('local');
  });
});

describe('DocumentsService.create — the same access rules as a real upload', () => {
  it("forces a resident's link onto their own flat as FLAT_PRIVATE, whatever accessLevel or flatId the body asks for", async () => {
    const { service, create } = setup();
    await service.create(SOCIETY, 'user-1', true, MY_FLAT, {
      title: 'Society AGM minutes',
      fileName: 'minutes.pdf',
      fileKey: 'https://drive.example.com/minutes.pdf',
      fileSize: 0,
      mimeType: 'application/pdf',
      accessLevel: DocumentAccessLevel.ADMIN_ONLY,
      flatId: OTHER_FLAT, // attempted: someone else's flat
    });

    const [{ data }] = create.mock.calls[0];
    expect(data.accessLevel).toBe(DocumentAccessLevel.FLAT_PRIVATE);
    expect(data.flatId).toBe(MY_FLAT);
  });

  it('refuses a resident with no flat, and writes nothing', async () => {
    const { service, create } = setup();
    await expect(
      service.create(SOCIETY, 'user-1', true, undefined, {
        title: 'x',
        fileName: 'x.pdf',
        fileKey: 'https://drive.example.com/x.pdf',
        fileSize: 0,
        mimeType: 'application/pdf',
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('refuses an unrecognised accessLevel from staff, and writes nothing', async () => {
    const { service, create } = setup();
    await expect(
      service.create(SOCIETY, 'admin-1', false, undefined, {
        title: 'x',
        fileName: 'x.pdf',
        fileKey: 'https://drive.example.com/x.pdf',
        fileSize: 0,
        mimeType: 'application/pdf',
        accessLevel: 'SUPER_SECRET' as DocumentAccessLevel,
      }),
    ).rejects.toThrow(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });

  it("refuses a staff FLAT_PRIVATE link naming a flat from another society, and writes nothing", async () => {
    const { service, create } = setup({ flatInSociety: false });
    await expect(
      service.create(SOCIETY, 'admin-1', false, undefined, {
        title: 'x',
        fileName: 'x.pdf',
        fileKey: 'https://drive.example.com/x.pdf',
        fileSize: 0,
        mimeType: 'application/pdf',
        accessLevel: DocumentAccessLevel.FLAT_PRIVATE,
        flatId: 'flat-in-another-society',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(create).not.toHaveBeenCalled();
  });

  it('stores a staff FLAT_PRIVATE link under the flat it names, once that flat is confirmed', async () => {
    const { service, prisma, create } = setup();
    await service.create(SOCIETY, 'admin-1', false, undefined, {
      title: 'Sale deed',
      fileName: 'deed.pdf',
      fileKey: 'https://drive.example.com/deed.pdf',
      fileSize: 0,
      mimeType: 'application/pdf',
      accessLevel: DocumentAccessLevel.FLAT_PRIVATE,
      flatId: OTHER_FLAT,
    });

    expect(prisma.flat.findFirst).toHaveBeenCalledWith({ where: { id: OTHER_FLAT, societyId: SOCIETY } });
    const [{ data }] = create.mock.calls[0];
    expect(data.flatId).toBe(OTHER_FLAT);
  });

  it.each([
    'javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox("x")',
    'not a url',
  ])('refuses an unsafe link scheme (%s), and writes nothing', async (fileKey) => {
    const { service, create } = setup();
    await expect(
      service.create(SOCIETY, 'admin-1', false, undefined, {
        title: 'x',
        fileName: 'x.pdf',
        fileKey,
        fileSize: 0,
        mimeType: 'text/html',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(create).not.toHaveBeenCalled();
  });
});

describe('DocumentsService — a stored path is never taken from the client', () => {
  it.each([
    `${BASE}/society-2/residents/flat-7/payments/their-receipt.jpg`,
    `${BASE}/${SOCIETY}/../society-2/society/documents/x.pdf`,
    '/etc/passwd',
  ])('refuses to download a stored key outside this society: %s', async (fileKey) => {
    const { service, storage, prisma } = setup();
    (prisma.document.findFirst as jest.Mock).mockResolvedValue({
      id: 'doc-bad',
      storageProvider: 'sftp',
      fileKey,
      fileName: 'x.pdf',
      mimeType: 'application/pdf',
    });

    await expect(service.getFileBuffer(SOCIETY, 'doc-bad', false, undefined)).rejects.toThrow(NotFoundException);
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('deactivates such a document without deleting the file it points at', async () => {
    const { service, storage, prisma } = setup();
    (prisma.document.findFirst as jest.Mock).mockResolvedValue({
      id: 'doc-bad',
      storageProvider: 'sftp',
      fileKey: `${BASE}/society-2/society/documents/x.pdf`,
      uploadedById: 'admin-1',
      accessLevel: DocumentAccessLevel.RESIDENTS_ONLY,
    });

    await service.softDelete(SOCIETY, 'doc-bad', 'admin-1', true);
    expect(storage.remove).not.toHaveBeenCalled();
    expect(prisma.document.update).toHaveBeenCalledWith({ where: { id: 'doc-bad' }, data: { isActive: false } });
  });

  it('still deletes the file of a document stored in this society', async () => {
    const { service, storage, prisma } = setup();
    const fileKey = `${BASE}/${SOCIETY}/residents/${MY_FLAT}/documents/3f2b8c1e-x.pdf`;
    (prisma.document.findFirst as jest.Mock).mockResolvedValue({
      id: 'doc-1',
      storageProvider: 'sftp',
      fileKey,
      uploadedById: 'user-1',
      accessLevel: DocumentAccessLevel.FLAT_PRIVATE,
    });

    await service.softDelete(SOCIETY, 'doc-1', 'user-1', false);
    expect(storage.remove).toHaveBeenCalledWith(fileKey);
  });
});

describe('DocumentsService — SFTP paths are not sent to clients', () => {
  const uploaded = {
    id: 'doc-1',
    storageProvider: 'sftp',
    fileKey: `${BASE}/${SOCIETY}/residents/${MY_FLAT}/documents/3f2b8c1e-x.pdf`,
    fileName: 'x.pdf',
  };
  const link = { id: 'doc-2', storageProvider: 'local', fileKey: 'https://drive.example.com/agm.pdf', fileName: 'agm.pdf' };

  it('blanks the key of an uploaded file in the list, and keeps a link intact', async () => {
    const { service, prisma } = setup();
    (prisma.document.findMany as jest.Mock).mockResolvedValue([uploaded, link]);

    const docs = await service.findAll(SOCIETY, true, undefined, MY_FLAT);
    expect(docs[0].fileKey).toBe('');
    expect(docs[1].fileKey).toBe('https://drive.example.com/agm.pdf');
  });

  it('blanks it in a single document, while the download still uses the real key', async () => {
    const { service, storage, prisma } = setup();
    (prisma.document.findFirst as jest.Mock).mockResolvedValue(uploaded);

    expect((await service.findOne(SOCIETY, 'doc-1', true, MY_FLAT)).fileKey).toBe('');
    await service.getFileBuffer(SOCIETY, 'doc-1', true, MY_FLAT);
    expect(storage.download).toHaveBeenCalledWith(uploaded.fileKey);
  });

  it('blanks it in the upload response', async () => {
    const { service } = setup();
    const doc = await service.upload(SOCIETY, 'user-1', true, MY_FLAT, PDF, { title: 'ID proof' });
    expect(doc.fileKey).toBe('');
  });

  it('blanks it in the delete response', async () => {
    const { service, prisma } = setup();
    (prisma.document.findFirst as jest.Mock).mockResolvedValue({
      ...uploaded,
      uploadedById: 'admin-1',
      accessLevel: DocumentAccessLevel.RESIDENTS_ONLY,
    });
    const doc = await service.softDelete(SOCIETY, 'doc-1', 'admin-1', true);
    expect(doc.fileKey).toBe('');
  });
});
