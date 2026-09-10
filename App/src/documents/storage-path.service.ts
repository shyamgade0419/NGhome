import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SftpStorageService } from './sftp-storage.service';
import { safeStorageName } from './file-safety';

/**
 * The single place that decides where a file lives on the SFTP server.
 *
 *   {base}/{societyId}/society/{folder}/{file}           society-owned
 *   {base}/{societyId}/residents/{flatId}/{folder}/{file} flat-owned
 *
 * Resident files are grouped by flatId, not by user: several people can hold
 * memberships on one flat, and flat ownership is what the access rules
 * already check (FLAT_PRIVATE documents are scoped to a flatId, payment
 * proofs to the payment's flat). Keeping the physical layout on the same key
 * as the security model means a folder never mixes two flats' files.
 *
 * Folders are created on first upload by SftpStorageService — nothing is
 * created up front.
 *
 * Every path segment is validated here rather than trusted. The ids arrive
 * from the signed token or from a database lookup, so a bad one means
 * something upstream is wrong; refusing it keeps a mistake from turning into
 * a write outside the society's folder. The folder is never taken from
 * user input: mobile sends the document category as free text, so it is
 * mapped onto a fixed list below and the typed value stays only in the
 * database.
 */

export const SOCIETY_FOLDERS = ['documents', 'notices', 'circulars', 'announcements', 'images'] as const;
export const RESIDENT_FOLDERS = ['profile', 'documents', 'complaints', 'payments', 'screenshots'] as const;

export type SocietyFolder = (typeof SOCIETY_FOLDERS)[number];
export type ResidentFolder = (typeof RESIDENT_FOLDERS)[number];

/** UUIDs and cuid-style database ids — and nothing that can mean a path. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * What safeStorageName produces, optionally prefixed with a UUID. Must start
 * with a letter or digit, so neither "." nor ".." can ever be a whole segment,
 * and has no separator, so it can never be more than one.
 */
const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/;

function assertSafeId(value: string, label: string): void {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    // The value itself is left out of the message: it may be attacker-shaped.
    throw new BadRequestException(`Invalid ${label} for file storage.`);
  }
}

function assertSafeFileName(value: string): void {
  if (typeof value !== 'string' || !SAFE_FILE_NAME.test(value)) {
    throw new BadRequestException('Invalid file name for file storage.');
  }
}

/**
 * Category text → folder. A category selects a folder only when it names one
 * of that owner's folders (case-insensitive, singular or plural); anything
 * else — including web's MINUTES / FINANCIAL / LEGAL / MAINTENANCE / OTHER and
 * whatever a resident types on mobile — goes to `documents`. Web's NOTICE maps
 * to `notices`. Predictable over clever: no fuzzy matching on free text.
 */
function folderFromCategory<T extends string>(
  category: string | null | undefined,
  folders: readonly T[],
): T | 'documents' {
  const key = (category ?? '').trim().toLowerCase();
  if (!key) return 'documents';
  for (const folder of folders) {
    if (key === folder || `${key}s` === folder) return folder;
  }
  return 'documents';
}

@Injectable()
export class StoragePathService {
  constructor(private readonly storage: SftpStorageService) {}

  /**
   * The physical name for an upload: `{uuid}-{sanitised original}`. The UUID
   * keeps two uploads of "receipt.pdf" apart; the sanitised tail keeps the
   * folder readable to whoever is looking at the server. The original name is
   * stored separately, as Document.fileName, for display.
   */
  storedFileName(originalName: string): string {
    return `${randomUUID()}-${safeStorageName(originalName)}`;
  }

  societyFile(societyId: string, folder: SocietyFolder, fileName: string): string {
    assertSafeId(societyId, 'society');
    if (!(SOCIETY_FOLDERS as readonly string[]).includes(folder)) {
      throw new BadRequestException('Invalid society storage folder.');
    }
    assertSafeFileName(fileName);
    return `${this.base()}/${societyId}/society/${folder}/${fileName}`;
  }

  residentFile(
    societyId: string,
    flatId: string,
    folder: ResidentFolder,
    fileName: string,
  ): string {
    assertSafeId(societyId, 'society');
    assertSafeId(flatId, 'flat');
    if (!(RESIDENT_FOLDERS as readonly string[]).includes(folder)) {
      throw new BadRequestException('Invalid resident storage folder.');
    }
    assertSafeFileName(fileName);
    return `${this.base()}/${societyId}/residents/${flatId}/${folder}/${fileName}`;
  }

  /**
   * A Document upload: flat-owned when it has a flatId, society-owned when it
   * does not. `category` is the raw value stored on the Document and is only
   * used to pick a folder.
   */
  documentFile(
    societyId: string,
    flatId: string | null | undefined,
    category: string | null | undefined,
    fileName: string,
  ): string {
    return flatId
      ? this.residentFile(societyId, flatId, folderFromCategory(category, RESIDENT_FOLDERS), fileName)
      : this.societyFile(societyId, folderFromCategory(category, SOCIETY_FOLDERS), fileName);
  }

  paymentProof(societyId: string, flatId: string, fileName: string): string {
    return this.residentFile(societyId, flatId, 'payments', fileName);
  }

  /**
   * The check made before a stored fileKey is read or deleted: true only for
   * a key inside this society's own folder, with no "." / ".." segment that
   * could climb back out of it. Both this layout and the older one
   * ({societyId}/{file}, {societyId}/payment-proofs/{file}) pass, so files
   * uploaded before the reorganisation stay reachable where they are.
   */
  isSocietyKey(societyId: string, fileKey: string): boolean {
    if (typeof societyId !== 'string' || !SAFE_ID.test(societyId)) return false;
    if (typeof fileKey !== 'string') return false;
    const prefix = `${this.base()}/${societyId}/`;
    if (!fileKey.startsWith(prefix)) return false;
    return fileKey
      .slice(prefix.length)
      .split('/')
      .every((segment) => segment !== '' && segment !== '.' && segment !== '..' && !/[\\\0]/.test(segment));
  }

  /** Base path without a trailing slash, so joins never produce "//". */
  private base(): string {
    return this.storage.getBasePath().replace(/\/+$/, '');
  }
}
