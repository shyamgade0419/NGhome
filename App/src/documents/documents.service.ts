import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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
}

@Injectable()
export class DocumentsService {
  constructor(private readonly prisma: PrismaService) {}

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

  async findAll(societyId: string, forResident = false, category?: string) {
    return this.prisma.document.findMany({
      where: {
        societyId,
        isActive: true,
        ...(category ? { category } : {}),
        ...(forResident
          ? { accessLevel: { in: [DocumentAccessLevel.PUBLIC, DocumentAccessLevel.RESIDENTS_ONLY] } }
          : {}),
      },
      include: { uploadedBy: { select: { id: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(societyId: string, id: string, forResident = false) {
    const doc = await this.prisma.document.findFirst({
      where: {
        id,
        societyId,
        isActive: true,
        // DEFECT-7: Residents cannot access ADMIN_ONLY documents by direct ID
        ...(forResident
          ? { accessLevel: { in: [DocumentAccessLevel.PUBLIC, DocumentAccessLevel.RESIDENTS_ONLY] } }
          : {}),
      },
    });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  async softDelete(societyId: string, id: string) {
    await this.findOne(societyId, id);
    return this.prisma.document.update({
      where: { id },
      data: { isActive: false },
    });
  }
}
