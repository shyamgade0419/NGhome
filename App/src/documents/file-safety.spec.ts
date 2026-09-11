/**
 * Both upload paths put the client's filename into the storage path, and
 * accepted any file type. Harmless while storage was off; live the moment it
 * is switched on.
 */

import { BadRequestException } from '@nestjs/common';
import { assertAllowedUpload, assertSafeLinkUrl, safeStorageName } from './file-safety';
import { normalizePrivateKey } from './sftp-storage.service';

describe('safeStorageName', () => {
  it.each([
    ['../../../etc/passwd', 'passwd'],
    ['..\\..\\windows\\system32\\x.pdf', 'x.pdf'],
    ['../other-society/receipt.pdf', 'receipt.pdf'],
    ['/absolute/path/bill.png', 'bill.png'],
  ])('strips every directory from %s', (input, expected) => {
    expect(safeStorageName(input)).toBe(expected);
  });

  it('never leaves a path separator or a parent reference behind', () => {
    for (const nasty of ['a/../../b.pdf', '....//....//x.pdf', '..', '../', '.\\..\\y.jpg']) {
      const out = safeStorageName(nasty);
      expect(out).not.toMatch(/[/\\]/);
      expect(out).not.toMatch(/^\.\./);
    }
  });

  it('keeps an ordinary name recognisable', () => {
    expect(safeStorageName('Maintenance Receipt - Sept 2026.pdf')).toBe(
      'Maintenance_Receipt_-_Sept_2026.pdf',
    );
  });

  it('does not produce a hidden file', () => {
    expect(safeStorageName('.htaccess')).not.toMatch(/^\./);
  });

  it('keeps the extension when trimming a very long name', () => {
    const out = safeStorageName(`${'a'.repeat(400)}.pdf`);
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out.endsWith('.pdf')).toBe(true);
  });

  it('falls back to a usable name when nothing survives', () => {
    expect(safeStorageName('///')).toBe('file');
  });
});

describe('assertAllowedUpload', () => {
  it.each([
    ['receipt.pdf', 'application/pdf'],
    ['upi-screenshot.jpg', 'image/jpeg'],
    ['photo.PNG', 'image/png'],
    ['IMG_0001.heic', 'image/heic'],
    ['agreement.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['accounts.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ])('accepts %s', (originalname, mimetype) => {
    expect(() => assertAllowedUpload({ originalname, mimetype })).not.toThrow();
  });

  it.each([
    ['page.html', 'text/html'],
    ['logo.svg', 'image/svg+xml'],
    ['setup.exe', 'application/x-msdownload'],
    ['script.js', 'application/javascript'],
  ])('rejects %s', (originalname, mimetype) => {
    expect(() => assertAllowedUpload({ originalname, mimetype })).toThrow(BadRequestException);
  });

  it('rejects a file whose extension disagrees with a harmless-looking type', () => {
    // The MIME type is client-supplied and free to fake.
    expect(() => assertAllowedUpload({ originalname: 'page.html', mimetype: 'image/png' })).toThrow(
      BadRequestException,
    );
  });
});

describe('assertAllowedUpload — file signature (magic bytes)', () => {
  const PDF = Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1');
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP', 'latin1')]);
  const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]); // docx/xlsx container
  const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]); // legacy doc/xls
  const HTML_SCRIPT = Buffer.from('<html><body><script>alert(document.cookie)</script>');

  it.each([
    ['receipt.pdf', 'application/pdf', PDF],
    ['photo.jpg', 'image/jpeg', JPEG],
    ['photo.png', 'image/png', PNG],
    ['photo.webp', 'image/webp', WEBP],
    ['agreement.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ZIP],
    ['accounts.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ZIP],
    ['old.doc', 'application/msword', OLE],
    ['old.xls', 'application/vnd.ms-excel', OLE],
  ])('accepts a genuine %s whose bytes match', (originalname, mimetype, buffer) => {
    expect(() => assertAllowedUpload({ originalname, mimetype, buffer })).not.toThrow();
  });

  it.each([
    ['receipt.pdf', 'application/pdf'],
    ['photo.jpg', 'image/jpeg'],
    ['photo.png', 'image/png'],
    ['photo.webp', 'image/webp'],
    ['agreement.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['old.doc', 'application/msword'],
  ])(
    'rejects %s whose extension and MIME type agree but the bytes are actually HTML/script',
    (originalname, mimetype) => {
      expect(() => assertAllowedUpload({ originalname, mimetype, buffer: HTML_SCRIPT })).toThrow(
        BadRequestException,
      );
    },
  );

  it('accepts a genuine HEIC by its ftyp box, without demanding one exact vendor sub-brand', () => {
    const heic = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftyp', 'latin1'),
      Buffer.from('heic', 'latin1'),
    ]);
    expect(() =>
      assertAllowedUpload({ originalname: 'IMG_0001.heic', mimetype: 'image/heic', buffer: heic }),
    ).not.toThrow();
  });

  it('does not signature-check txt/csv — no reliable magic bytes for plain text', () => {
    expect(() =>
      assertAllowedUpload({ originalname: 'notes.txt', mimetype: 'text/plain', buffer: HTML_SCRIPT }),
    ).not.toThrow();
  });

  it('skips the signature check when no buffer is available (extension+MIME only, unchanged behaviour)', () => {
    expect(() => assertAllowedUpload({ originalname: 'receipt.pdf', mimetype: 'application/pdf' })).not.toThrow();
  });
});

describe('assertSafeLinkUrl', () => {
  it.each([
    'https://drive.example.com/agm-minutes.pdf',
    'http://intranet.example.org/notice.pdf',
  ])('accepts %s', (url) => {
    expect(() => assertSafeLinkUrl(url)).not.toThrow();
  });

  it.each([
    'javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox("x")',
    'file:///etc/passwd',
    'ftp://example.com/x.pdf',
    'not a url at all',
    '',
  ])('rejects %j', (url) => {
    expect(() => assertSafeLinkUrl(url)).toThrow(BadRequestException);
  });
});

describe('normalizePrivateKey', () => {
  const pem =
    '-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\nBBBB\n-----END OPENSSH PRIVATE KEY-----\n';

  it('restores newlines from a key delivered as one line with literal \\n', () => {
    const oneLine = pem.trim().replace(/\n/g, '\\n');
    expect(normalizePrivateKey(oneLine)).toBe(pem);
  });

  it('leaves a correctly formatted key alone', () => {
    expect(normalizePrivateKey(pem)).toBe(pem);
  });

  it('tolerates Windows line endings', () => {
    expect(normalizePrivateKey(pem.replace(/\n/g, '\r\n'))).toBe(pem);
  });
});
