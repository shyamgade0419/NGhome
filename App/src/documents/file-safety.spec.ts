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
