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

export function assertAllowedUpload(file: { originalname: string; mimetype: string }) {
  const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(ext)) {
    throw new BadRequestException(
      'That file type is not supported. Upload a PDF, a photo (JPG, PNG, WebP, HEIC), ' +
        'or a Word, Excel, text or CSV document.',
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
