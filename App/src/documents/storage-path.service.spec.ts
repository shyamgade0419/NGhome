/**
 * StoragePathService is the only place SFTP paths are built, so it is also
 * the only place traversal can be stopped. Every segment is validated; the
 * folder never comes from user input.
 */

import { BadRequestException } from '@nestjs/common';
import { StoragePathService } from './storage-path.service';
import { SftpStorageService } from './sftp-storage.service';

function pathsWithBase(base = '/ng-home-documents') {
  const storage = { getBasePath: () => base } as unknown as SftpStorageService;
  return new StoragePathService(storage);
}

describe('StoragePathService — layout', () => {
  const paths = pathsWithBase();

  it('society-owned: society-1 + notices', () => {
    expect(paths.societyFile('society-1', 'notices', 'file')).toBe(
      '/ng-home-documents/society-1/society/notices/file',
    );
  });

  it('flat-owned: society-1 + flat-10 + documents', () => {
    expect(paths.residentFile('society-1', 'flat-10', 'documents', 'file')).toBe(
      '/ng-home-documents/society-1/residents/flat-10/documents/file',
    );
  });

  it('payment proof: society-1 + flat-10', () => {
    expect(paths.paymentProof('society-1', 'flat-10', 'file')).toBe(
      '/ng-home-documents/society-1/residents/flat-10/payments/file',
    );
  });

  it('accepts real UUID ids', () => {
    const society = '3f2b8c1e-9d4a-4e7b-8a1c-2f6d9e0b5a7c';
    const flat = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
    expect(paths.residentFile(society, flat, 'profile', 'x.jpg')).toBe(
      `/ng-home-documents/${society}/residents/${flat}/profile/x.jpg`,
    );
  });

  it('does not double the slash when the base path ends in one', () => {
    expect(pathsWithBase('/ng-home-documents/').societyFile('s1', 'images', 'a.png')).toBe(
      '/ng-home-documents/s1/society/images/a.png',
    );
  });

  it('follows whatever base path the deployment configures', () => {
    expect(pathsWithBase('/home/novagade/nghome-storage').paymentProof('s1', 'f1', 'r.pdf')).toBe(
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

  it('puts a document without a flat under the society', () => {
    expect(society('notices')).toBe('/ng-home-documents/s1/society/notices/f.pdf');
  });

  it('puts a document with a flat under that flat', () => {
    expect(resident('documents')).toBe('/ng-home-documents/s1/residents/flat-1/documents/f.pdf');
  });

  it("maps web's NOTICE to notices, case-insensitively", () => {
    expect(society('NOTICE')).toBe('/ng-home-documents/s1/society/notices/f.pdf');
  });

  it.each(['MINUTES', 'FINANCIAL', 'LEGAL', 'MAINTENANCE', 'OTHER'])(
    "sends web's %s to documents",
    (category) => {
      expect(society(category)).toBe('/ng-home-documents/s1/society/documents/f.pdf');
    },
  );

  it('sends free text typed on mobile to documents', () => {
    expect(resident('Rent agreement 2026')).toBe(
      '/ng-home-documents/s1/residents/flat-1/documents/f.pdf',
    );
  });

  it('defaults to documents when there is no category', () => {
    expect(society(undefined)).toBe('/ng-home-documents/s1/society/documents/f.pdf');
    expect(resident(null)).toBe('/ng-home-documents/s1/residents/flat-1/documents/f.pdf');
  });

  it('never turns a traversal-shaped category into a directory', () => {
    for (const hostile of ['../../other-society', '../../../etc', '..\\..\\x', '/etc/passwd']) {
      expect(society(hostile)).toBe('/ng-home-documents/s1/society/documents/f.pdf');
      expect(resident(hostile)).toBe('/ng-home-documents/s1/residents/flat-1/documents/f.pdf');
    }
  });

  it('keeps each owner to its own folders', () => {
    // "screenshots" is a flat folder, not a society one; "images" the reverse.
    expect(society('screenshots')).toBe('/ng-home-documents/s1/society/documents/f.pdf');
    expect(resident('images')).toBe('/ng-home-documents/s1/residents/flat-1/documents/f.pdf');
    expect(resident('screenshot')).toBe('/ng-home-documents/s1/residents/flat-1/screenshots/f.pdf');
  });
});

describe('StoragePathService — traversal', () => {
  const paths = pathsWithBase();
  const hostile = ['../', '../../', '..', '.', 'foo/bar', 'foo\\bar', '/etc', 'C:\\Windows', '', ' ', 'a b'];

  it.each(hostile)('rejects %j as a society id', (value) => {
    expect(() => paths.societyFile(value, 'documents', 'f.pdf')).toThrow(BadRequestException);
  });

  it.each(hostile)('rejects %j as a flat id', (value) => {
    expect(() => paths.residentFile('s1', value, 'documents', 'f.pdf')).toThrow(BadRequestException);
  });

  it.each(['../x.pdf', 'a/b.pdf', 'a\\b.pdf', '..', '.', '.hidden', '/abs.pdf', ''])(
    'rejects %j as a file name',
    (value) => {
      expect(() => paths.societyFile('s1', 'documents', value)).toThrow(BadRequestException);
    },
  );

  it('rejects a folder outside the allowlist, even when forced past the type', () => {
    expect(() => paths.societyFile('s1', '../x' as never, 'f.pdf')).toThrow(BadRequestException);
    expect(() => paths.residentFile('s1', 'f1', 'payments/../../other' as never, 'f.pdf')).toThrow(
      BadRequestException,
    );
  });

  it('does not echo the rejected value back in the error', () => {
    expect(() => paths.societyFile('../../evil', 'documents', 'f.pdf')).toThrow(
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
  ])('accepts %s for s1', (key) => {
    expect(paths.isSocietyKey('s1', key)).toBe(true);
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
  ])('refuses %j for s1', (key) => {
    expect(paths.isSocietyKey('s1', key)).toBe(false);
  });

  it('refuses when the society id itself is unsafe', () => {
    expect(paths.isSocietyKey('..', '/ng-home-documents/../a.pdf')).toBe(false);
    expect(paths.isSocietyKey('', '/ng-home-documents//a.pdf')).toBe(false);
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

  it('always produces a name the path methods accept — even from a hostile original', () => {
    for (const original of ['../../../etc/passwd', '..\\..\\win.ini', '.htaccess', '///']) {
      const name = paths.storedFileName(original);
      expect(() => paths.societyFile('s1', 'documents', name)).not.toThrow();
    }
  });
});
