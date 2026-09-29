import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID, randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SftpStorageService } from './sftp-storage.service';
import { safeStorageName } from './file-safety';
import { slugify } from '../common/utils/slugify';

/**
 * The single place that decides where a file lives on the SFTP server.
 *
 *   {base}/{segment}/society/{folder}/{file}           society-owned
 *   {base}/{segment}/residents/{flatId}/{folder}/{file} flat-owned
 *
 * `segment` is the society's storage folder name — Society.storageSlug once
 * one exists (e.g. "chaitanya-classic-3-a1b2c3d4"), the raw societyId until
 * then. It is generated once, lazily, on that society's first upload after
 * this shipped (resolveSegment below), and never recomputed from a later
 * name change: renaming a society must not split its files across two
 * folders. Files uploaded before this shipped keep the raw-id folder they
 * already have forever — nothing moves them, and isSocietyKey below accepts
 * both forms so they stay readable.
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

/** UUIDs and cuid-style database ids — and nothing that can mean a path. Also
 *  what a generated storage slug must match: see slugify() + the id suffix
 *  appended in createStorageSlug(), both lowercase alphanumeric and hyphens. */
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

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
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
  constructor(
    private readonly storage: SftpStorageService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * The physical name for an upload: `{uuid}-{sanitised original}`. The UUID
   * keeps two uploads of "receipt.pdf" apart; the sanitised tail keeps the
   * folder readable to whoever is looking at the server. The original name is
   * stored separately, as Document.fileName, for display.
   */
  storedFileName(originalName: string): string {
    return `${randomUUID()}-${safeStorageName(originalName)}`;
  }

  async societyFile(societyId: string, folder: SocietyFolder, fileName: string): Promise<string> {
    assertSafeId(societyId, 'society');
    if (!(SOCIETY_FOLDERS as readonly string[]).includes(folder)) {
      throw new BadRequestException('Invalid society storage folder.');
    }
    assertSafeFileName(fileName);
    const segment = await this.resolveSegment(societyId);
    return `${this.base()}/${segment}/society/${folder}/${fileName}`;
  }

  async residentFile(
    societyId: string,
    flatId: string,
    folder: ResidentFolder,
    fileName: string,
  ): Promise<string> {
    assertSafeId(societyId, 'society');
    assertSafeId(flatId, 'flat');
    if (!(RESIDENT_FOLDERS as readonly string[]).includes(folder)) {
      throw new BadRequestException('Invalid resident storage folder.');
    }
    assertSafeFileName(fileName);
    const segment = await this.resolveSegment(societyId);
    return `${this.base()}/${segment}/residents/${flatId}/${folder}/${fileName}`;
  }

  /**
   * A Document upload: flat-owned when it has a flatId, society-owned when it
   * does not. `category` is the raw value stored on the Document and is only
   * used to pick a folder.
   */
  async documentFile(
    societyId: string,
    flatId: string | null | undefined,
    category: string | null | undefined,
    fileName: string,
  ): Promise<string> {
    return flatId
      ? this.residentFile(societyId, flatId, folderFromCategory(category, RESIDENT_FOLDERS), fileName)
      : this.societyFile(societyId, folderFromCategory(category, SOCIETY_FOLDERS), fileName);
  }

  async paymentProof(societyId: string, flatId: string, fileName: string): Promise<string> {
    return this.residentFile(societyId, flatId, 'payments', fileName);
  }

  /**
   * The check made before a stored fileKey is read or deleted: true for a key
   * inside this society's own folder — under either its raw id (every file
   * uploaded before storageSlug existed, or before this society had uploaded
   * anything since) or its storage slug (every upload since) — with no "."
   * or ".." segment that could climb back out of it.
   */
  async isSocietyKey(societyId: string, fileKey: string): Promise<boolean> {
    if (typeof societyId !== 'string' || !SAFE_ID.test(societyId)) return false;
    if (typeof fileKey !== 'string') return false;

    const society = await this.prisma.society.findUnique({
      where: { id: societyId },
      select: { storageSlug: true },
    });
    const segments = [societyId, society?.storageSlug].filter((s): s is string => !!s);
    return segments.some((segment) => this.matchesSegment(segment, fileKey));
  }

  private matchesSegment(segment: string, fileKey: string): boolean {
    const prefix = `${this.base()}/${segment}/`;
    if (!fileKey.startsWith(prefix)) return false;
    return fileKey
      .slice(prefix.length)
      .split('/')
      .every((part) => part !== '' && part !== '.' && part !== '..' && !/[\\\0]/.test(part));
  }

  /**
   * The society's storage folder name: its existing slug, or one created and
   * persisted now. Deterministic from (name, id) — two concurrent first
   * uploads for the same society compute and write the identical value, so
   * this needs no locking. A society row that has vanished between the
   * caller's own lookup and this one is a should-never-happen; assertSafeId
   * above already validated the id's shape, so this throws the same generic
   * "invalid society" error rather than a confusing null-property crash.
   */
  private async resolveSegment(societyId: string): Promise<string> {
    const society = await this.prisma.society.findUnique({
      where: { id: societyId },
      select: { name: true, storageSlug: true },
    });
    if (!society) throw new BadRequestException('Invalid society for file storage.');
    if (society.storageSlug) return society.storageSlug;
    return this.createStorageSlug(societyId, society.name);
  }

  private async createStorageSlug(societyId: string, name: string): Promise<string> {
    const slug = `${slugify(name)}-${societyId.replace(/-/g, '').slice(0, 8)}`;
    try {
      await this.prisma.society.update({ where: { id: societyId }, data: { storageSlug: slug } });
      return slug;
    } catch (err) {
      // Two different societies landing on the same slug — the id suffix
      // above makes this astronomically unlikely, not impossible. Widen it
      // with a few random hex characters and accept whatever that gives us;
      // this society's files still land somewhere readable, just with one
      // more disambiguator, rather than the upload failing outright.
      if (!isUniqueConstraintError(err)) throw err;
      const widened = `${slug}-${randomBytes(2).toString('hex')}`;
      await this.prisma.society.update({ where: { id: societyId }, data: { storageSlug: widened } });
      return widened;
    }
  }

  /** Base path without a trailing slash, so joins never produce "//". */
  private base(): string {
    return this.storage.getBasePath().replace(/\/+$/, '');
  }
}
