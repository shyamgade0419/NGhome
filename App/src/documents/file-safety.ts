import { BadRequestException } from '@nestjs/common';

/**
 * Upload safety, shared by every route that writes a user's file to storage.
 *
 * Both upload paths built the remote path from the client-supplied filename:
 *   `${base}/${societyId}/${uuid}-${file.originalname}`
 * A name containing `../` walked straight out of that folder — into another
 * society's documents, or anywhere else the SFTP account could write. And any
 * file type was accepted, so an .html or .svg carrying script could be stored
 * and later opened from the app. Neither mattered while storage was switched
 * off; both go live the moment it is switched on.
 */

/** What people actually attach: receipts, photos, PDFs, office documents. */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/**
 * Checked against the extension as well as the MIME type. The MIME type comes
 * from the client and costs nothing to fake; requiring the extension to agree
 * closes the easy version of "call it image/png, name it page.html".
 */
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif',
  'txt', 'csv', 'doc', 'docx', 'xls', 'xlsx',
]);

/**
 * The first few bytes of a real file of each type — checked against the
 * actual upload, not just its claimed name and MIME type, both of which the
 * client sets and neither of which cost anything to fake. Catches an HTML/
 * script/executable payload renamed to look like an allowed extension with
 * a matching Content-Type (an "evil.html" sent as "receipt.pdf",
 * application/pdf) — the exact case the extension+MIME check above cannot
 * see, because both of those claims agree with each other while lying about
 * the actual bytes.
 *
 * txt/csv are deliberately not checked here: plain text has no reliable
 * signature, and rejecting on content would risk real receipts/exports that
 * happen to look unusual — the extension+MIME agreement above is what
 * stands in for them.
 */
const SIGNATURE_CHECKS: Record<string, (buf: Buffer) => boolean> = {
  pdf: (buf) => buf.subarray(0, 4).toString('latin1') === '%PDF',
  jpg: (buf) => buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  jpeg: (buf) => buf.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  png: (buf) => buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  webp: (buf) => buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP',
  // ISO base media file format box header — real across iPhone/Android
  // camera vendors' many HEIC/HEIF sub-brands; deliberately not stricter
  // than this, to avoid rejecting a genuine photo over a brand this list
  // didn't happen to name.
  heic: (buf) => buf.subarray(4, 8).toString('latin1') === 'ftyp',
  heif: (buf) => buf.subarray(4, 8).toString('latin1') === 'ftyp',
  // .docx / .xlsx are ZIP containers (Office Open XML).
  docx: (buf) => buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  xlsx: (buf) => buf.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])),
  // Legacy .doc / .xls — OLE2 compound file.
  doc: (buf) => buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
  xls: (buf) => buf.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])),
};

export function assertAllowedUpload(file: { originalname: string; mimetype: string; buffer?: Buffer }) {
  const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(ext)) {
    throw new BadRequestException(
      'That file type is not supported. Upload a PDF, a photo (JPG, PNG, WebP, HEIC), ' +
        'or a Word, Excel, text or CSV document.',
    );
  }

  const checkSignature = SIGNATURE_CHECKS[ext];
  if (checkSignature && file.buffer && !checkSignature(file.buffer)) {
    throw new BadRequestException(
      "That file's contents don't match a " + ext.toUpperCase() + ' file — it may be renamed or corrupted.',
    );
  }
}

/**
 * A filename that is safe to put in a storage path and still recognisable to
 * a person. Keeps only the final path segment — so both `/` and `\` separators
 * are gone, and with them any `..` — then replaces anything outside a
 * conservative character set, collapses the leftovers, and caps the length.
 *
 * The original name is not lost: callers store `file.originalname` separately
 * as the display name. This only governs the name on disk.
 */
export function safeStorageName(originalName: string): string {
  const base = originalName.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+/, '') // no hidden files, no leading dots left over from ".."
    .slice(-120); // keep the end, where the extension is
  return cleaned || 'file';
}

/**
 * A "link" document (DocumentsService.create) stores whatever URL the
 * caller provides as fileKey, and the frontend renders it straight into an
 * <a href>. Without this, a fileKey of `javascript:...` or `data:text/html,
 * <script>...` would sit in the database as a normal-looking document and
 * run in the browser of whoever clicked it — stored XSS, not a storage bug,
 * but the same "never trust what the client hands you for a path/URL"
 * principle applies. Only http/https are ever safe to hand to <a href>.
 */
export function assertSafeLinkUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BadRequestException('That link is not a valid URL.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException('Only http:// or https:// links are supported.');
  }
}
