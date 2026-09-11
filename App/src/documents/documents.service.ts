import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SftpStorageService } from './sftp-storage.service';
import { assertAllowedUpload, assertSafeLinkUrl } from './file-safety';
import { StoragePathService } from './storage-path.service';
import { DocumentAccessLevel } from '@prisma/client';

export interface CreateDocumentDto {
  title: string;
  description?: string;
  fileName: string;
  fileKey: string;
  fileSize: number;
  mimeType: string;
  storageProvider?: string;
  accessLevel?: DocumentAccessLevel;
  category?: string;
  linkedEntityType?: string;
  linkedEntityId?: string;
  // Only meaningful for admin/staff registering a private link on a
  // resident's behalf; a resident's own flatId is always used instead.
  flatId?: string;
}

export interface UploadDocumentMeta {
  title: string;
  description?: string;
  category?: string;
  // Only meaningful for admin/staff/accountant/committee — a resident's
  // upload is always forced to FLAT_PRIVATE regardless of what's sent here.
  accessLevel?: string;
  // Only meaningful for admin/staff uploading a private doc on a
  // resident's behalf; a resident's own flatId is always used instead.
  flatId?: string;
}

const ADMIN_SELECTABLE_LEVELS: string[] = [
  DocumentAccessLevel.PUBLIC,
  DocumentAccessLevel.RESIDENTS_ONLY,
  DocumentAccessLevel.ADMIN_ONLY,
  DocumentAccessLevel.COMMITTEE_ONLY,
  DocumentAccessLevel.FLAT_PRIVATE,
];

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: SftpStorageService,
    private readonly paths: StoragePathService,
  ) {}

  async create(
    societyId: string,
    uploadedById: string,
    isResident: boolean,
    uploaderFlatId: string | undefined,
    dto: CreateDocumentDto,
  ) {
    // Same access-level resolution as a real upload: a resident registering a
    // link is forced onto their own flat as FLAT_PRIVATE too, so this endpoint
    // can't be used to slip a document to ADMIN_ONLY/COMMITTEE_ONLY, or onto a
    // flat that isn't theirs — the accessLevel/flatId in the body only ever
    // decide anything for admin/staff.
    const { accessLevel, flatId } = await this.resolveAccessAndFlat(societyId, isResident, uploaderFlatId, {
      accessLevel: dto.accessLevel,
      flatId: dto.flatId,
    });

    // fileKey here is a link the client typed in, not a storage path — the
    // frontend renders it straight into an <a href>, so only http/https may
    // ever land in the database (see assertSafeLinkUrl).
    assertSafeLinkUrl(dto.fileKey);

    return this.prisma.document.create({
      data: {
        societyId,
        flatId,
        uploadedById,
        title: dto.title,
        description: dto.description,
        fileName: dto.fileName,
        fileKey: dto.fileKey,
        fileSize: dto.fileSize,
        mimeType: dto.mimeType,
        // Always a link. dto.storageProvider is ignored: a caller-set 'sftp'
        // would make their fileKey a server path that download and delete
        // then act on — any file, in any society. Only upload() makes SFTP
        // documents, with a path it built itself.
        storageProvider: 'local',
        accessLevel,
        category: dto.category,
        linkedEntityType: dto.linkedEntityType,
        linkedEntityId: dto.linkedEntityId,
      },
    });
  }

  /**
   * What accessLevel and flatId a new document (link or uploaded) gets,
   * shared by create() and upload() so the same rule protects both: a
   * resident is always forced onto their own flat as FLAT_PRIVATE — never
   * trust the client for either value, the same way flatId ownership is
   * never trusted elsewhere in this codebase (buildings/flats DEFECT-1
   * pattern). Staff may pick any of the fixed levels, and a FLAT_PRIVATE
   * pick must name a flat that actually belongs to this society.
   */
  private async resolveAccessAndFlat(
    societyId: string,
    isResident: boolean,
    uploaderFlatId: string | undefined,
    requested: { accessLevel?: string; flatId?: string },
  ): Promise<{ accessLevel: DocumentAccessLevel; flatId: string | null }> {
    if (isResident) {
      if (!uploaderFlatId) {
        throw new ForbiddenException('Only a resident assigned to a flat can add flat documents.');
      }
      return { accessLevel: DocumentAccessLevel.FLAT_PRIVATE, flatId: uploaderFlatId };
    }

    const level = requested.accessLevel ?? DocumentAccessLevel.RESIDENTS_ONLY;
    if (!ADMIN_SELECTABLE_LEVELS.includes(level)) {
      throw new BadRequestException(`Invalid accessLevel "${level}"`);
    }
    if (level === DocumentAccessLevel.FLAT_PRIVATE) {
      if (!requested.flatId) throw new BadRequestException('flatId is required for FLAT_PRIVATE documents');
      const flat = await this.prisma.flat.findFirst({ where: { id: requested.flatId, societyId } });
      if (!flat) throw new NotFoundException('Flat not found in this society');
      return { accessLevel: level as DocumentAccessLevel, flatId: requested.flatId };
    }
    return { accessLevel: level as DocumentAccessLevel, flatId: null };
  }

  /**
   * Real file upload (SFTP-backed), as opposed to create() above which only
   * ever stores a caller-supplied link.
   */
  async upload(
    societyId: string,
    uploaderId: string,
    isResident: boolean,
    uploaderFlatId: string | undefined,
    file: { originalname: string; size: number; mimetype: string; buffer: Buffer },
    meta: UploadDocumentMeta,
  ) {
    const { accessLevel, flatId } = await this.resolveAccessAndFlat(societyId, isResident, uploaderFlatId, meta);

    assertAllowedUpload(file);

    // Flat-owned when flatId is set, society-owned otherwise. flatId here is
    // never the client's for a resident — it was forced to uploaderFlatId
    // above — and for staff it has just been checked against this society.
    // The on-disk name is sanitised; file.originalname is still stored below
    // as fileName, so people see the name they uploaded.
    const remotePath = this.paths.documentFile(
      societyId,
      flatId,
      meta.category,
      this.paths.storedFileName(file.originalname),
    );
    await this.storage.upload(file.buffer, remotePath);

    try {
      const doc = await this.prisma.document.create({
        data: {
          societyId,
          flatId,
          uploadedById: uploaderId,
          title: meta.title,
          description: meta.description,
          fileName: file.originalname,
          fileKey: remotePath,
          fileSize: file.size,
          mimeType: file.mimetype,
          storageProvider: 'sftp',
          accessLevel,
          category: meta.category,
        },
      });
      return toClient(doc);
    } catch (err) {
      // Without a row pointing at it, the file is unreachable and would sit on
      // the server forever. remove() never throws, so the original error is
      // what the caller sees.
      await this.storage.remove(remotePath);
      throw err;
    }
  }

  async findAll(
    societyId: string,
    forResident: boolean,
    category: string | undefined,
    callerFlatId: string | undefined,
  ) {
    const docs = await this.prisma.document.findMany({
      where: {
        societyId,
        isActive: true,
        ...(category ? { category } : {}),
        OR: [
          {
            accessLevel: forResident
              ? { in: [DocumentAccessLevel.PUBLIC, DocumentAccessLevel.RESIDENTS_ONLY] }
              : { not: DocumentAccessLevel.FLAT_PRIVATE },
          },
          ...(callerFlatId
            ? [{ accessLevel: DocumentAccessLevel.FLAT_PRIVATE, flatId: callerFlatId }]
            : []),
        ],
      },
      include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map(toClient);
  }

  async findOne(
    societyId: string,
    id: string,
    forResident: boolean,
    callerFlatId: string | undefined,
  ) {
    return toClient(await this.findVisible(societyId, id, forResident, callerFlatId));
  }

  /** findOne's access decision, with the stored fileKey intact for internal use. */
  private async findVisible(
    societyId: string,
    id: string,
    forResident: boolean,
    callerFlatId: string | undefined,
  ) {
    const doc = await this.prisma.document.findFirst({
      where: {
        id,
        societyId,
        isActive: true,
        // DEFECT-7: Residents cannot access ADMIN_ONLY documents by direct ID
        OR: [
          {
            accessLevel: forResident
              ? { in: [DocumentAccessLevel.PUBLIC, DocumentAccessLevel.RESIDENTS_ONLY] }
              : { not: DocumentAccessLevel.FLAT_PRIVATE },
          },
          ...(callerFlatId
            ? [{ accessLevel: DocumentAccessLevel.FLAT_PRIVATE, flatId: callerFlatId }]
            : []),
        ],
      },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  /** Streams the actual bytes back — findVisible() above enforces the same
   *  visibility rule as findOne, so the access decision is not re-made here
   *  (matches the pattern: one place owns the access decision, everything
   *  downstream trusts it). The key is still checked to be inside this
   *  society's folder before the server is touched. */
  async getFileBuffer(societyId: string, id: string, forResident: boolean, callerFlatId: string | undefined) {
    const doc = await this.findVisible(societyId, id, forResident, callerFlatId);
    if (doc.storageProvider !== 'sftp') {
      throw new BadRequestException('This document is a link, not an uploaded file — open fileKey directly.');
    }
    if (!this.paths.isSocietyKey(societyId, doc.fileKey)) {
      throw new NotFoundException('File not found');
    }
    const buffer = await this.storage.download(doc.fileKey);
    return { buffer, fileName: doc.fileName, mimeType: doc.mimeType };
  }

  /**
   * Admin can delete any document by id — including a FLAT_PRIVATE one they
   * can't browse or open, the same "takedown power without content
   * visibility" split as everywhere else this session's privacy model
   * applies. Anyone else may only delete their own upload, and only if
   * it's FLAT_PRIVATE — a resident deleting their own tax receipt, not a
   * resident deleting official society content they didn't create.
   */
  async softDelete(societyId: string, id: string, callerId: string, isAdmin: boolean) {
    const doc = await this.prisma.document.findFirst({ where: { id, societyId, isActive: true } });
    if (!doc) throw new NotFoundException('Document not found');

    if (!isAdmin) {
      if (doc.uploadedById !== callerId || doc.accessLevel !== DocumentAccessLevel.FLAT_PRIVATE) {
        throw new ForbiddenException('You can only delete your own flat documents.');
      }
    }

    // A key outside this society's folder is never deleted; the row is still
    // deactivated.
    if (doc.storageProvider === 'sftp' && this.paths.isSocietyKey(societyId, doc.fileKey)) {
      await this.storage.remove(doc.fileKey);
    }
    return toClient(
      await this.prisma.document.update({
        where: { id },
        data: { isActive: false },
      }),
    );
  }
}

/**
 * What a client sees of a document. An uploaded file's fileKey is its path on
 * the SFTP server, so it is blanked; clients fetch the bytes through
 * GET /documents/:id/download instead. A link document's fileKey is the link
 * itself and is left alone.
 */
function toClient<T extends { storageProvider: string; fileKey: string }>(doc: T): T {
  return doc.storageProvider === 'sftp' ? { ...doc, fileKey: '' } : doc;
}
