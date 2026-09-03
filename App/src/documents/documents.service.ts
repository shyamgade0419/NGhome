import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SftpStorageService } from './sftp-storage.service';
import { DocumentAccessLevel } from '@prisma/client';
import { randomUUID } from 'crypto';

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
  ) {}

  async create(societyId: string, uploadedById: string, dto: CreateDocumentDto) {
    return this.prisma.document.create({
      data: {
        societyId,
        uploadedById,
        title: dto.title,
        description: dto.description,
        fileName: dto.fileName,
        fileKey: dto.fileKey,
        fileSize: dto.fileSize,
        mimeType: dto.mimeType,
        storageProvider: dto.storageProvider ?? 'local',
        accessLevel: dto.accessLevel ?? DocumentAccessLevel.RESIDENTS_ONLY,
        category: dto.category,
        linkedEntityType: dto.linkedEntityType,
        linkedEntityId: dto.linkedEntityId,
      },
    });
  }

  /**
   * Real file upload (SFTP-backed), as opposed to create() above which only
   * ever stored a caller-supplied link. A RESIDENT calling this always gets
   * FLAT_PRIVATE forced onto their own flatId — never trust the client for
   * either value, the same way flatId ownership is never trusted elsewhere
   * in this codebase (buildings/flats DEFECT-1 pattern).
   */
  async upload(
    societyId: string,
    uploaderId: string,
    isResident: boolean,
    uploaderFlatId: string | undefined,
    file: { originalname: string; size: number; mimetype: string; buffer: Buffer },
    meta: UploadDocumentMeta,
  ) {
    let accessLevel: DocumentAccessLevel;
    let flatId: string | null = null;

    if (isResident) {
      if (!uploaderFlatId) {
        throw new ForbiddenException('Only a resident assigned to a flat can upload flat documents.');
      }
      accessLevel = DocumentAccessLevel.FLAT_PRIVATE;
      flatId = uploaderFlatId;
    } else {
      const requested = meta.accessLevel ?? DocumentAccessLevel.RESIDENTS_ONLY;
      if (!ADMIN_SELECTABLE_LEVELS.includes(requested)) {
        throw new BadRequestException(`Invalid accessLevel "${requested}"`);
      }
      accessLevel = requested as DocumentAccessLevel;
      if (accessLevel === DocumentAccessLevel.FLAT_PRIVATE) {
        if (!meta.flatId) throw new BadRequestException('flatId is required for FLAT_PRIVATE documents');
        const flat = await this.prisma.flat.findFirst({ where: { id: meta.flatId, societyId } });
        if (!flat) throw new NotFoundException('Flat not found in this society');
        flatId = meta.flatId;
      }
    }

    const remotePath = `${this.storage.getBasePath()}/${societyId}/${randomUUID()}-${file.originalname}`;
    await this.storage.upload(file.buffer, remotePath);

    return this.prisma.document.create({
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
  }

  async findAll(
    societyId: string,
    forResident: boolean,
    category: string | undefined,
    callerFlatId: string | undefined,
  ) {
    return this.prisma.document.findMany({
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
  }

  async findOne(
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

  /** Streams the actual bytes back — findOne() above enforces the same
   *  visibility rule before this is ever called, so nothing extra is
   *  re-checked here (matches the pattern: one place owns the access
   *  decision, everything downstream trusts it). */
  async getFileBuffer(societyId: string, id: string, forResident: boolean, callerFlatId: string | undefined) {
    const doc = await this.findOne(societyId, id, forResident, callerFlatId);
    if (doc.storageProvider !== 'sftp') {
      throw new BadRequestException('This document is a link, not an uploaded file — open fileKey directly.');
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

    if (doc.storageProvider === 'sftp') {
      await this.storage.remove(doc.fileKey);
    }
    return this.prisma.document.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
