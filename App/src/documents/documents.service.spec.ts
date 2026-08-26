/**
 * DEFECT-7: documents.findOne resident access-level visibility unit tests.
 */

import { DocumentsService } from './documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { DocumentAccessLevel } from '@prisma/client';

const SOCIETY_ID = 'society-x';
const DOC_ID = 'doc-1';

function makeDoc(accessLevel: DocumentAccessLevel) {
  return { id: DOC_ID, societyId: SOCIETY_ID, isActive: true, accessLevel, title: 'Test Doc' };
}

function makePrisma(docResult: unknown) {
  return {
    document: { findFirst: jest.fn().mockResolvedValue(docResult) },
  } as unknown as PrismaService;
}

describe('DocumentsService — findOne resident visibility (DEFECT-7)', () => {
  describe('admin access (forResident = false)', () => {
    it('returns a PUBLIC document', async () => {
      const doc = makeDoc(DocumentAccessLevel.PUBLIC);
      await expect(new DocumentsService(makePrisma(doc)).findOne(SOCIETY_ID, DOC_ID, false)).resolves.toEqual(doc);
    });

    it('returns a RESIDENTS_ONLY document', async () => {
      const doc = makeDoc(DocumentAccessLevel.RESIDENTS_ONLY);
      await expect(new DocumentsService(makePrisma(doc)).findOne(SOCIETY_ID, DOC_ID, false)).resolves.toEqual(doc);
    });

    it('returns an ADMIN_ONLY document (admins bypass access-level filter)', async () => {
      const doc = makeDoc(DocumentAccessLevel.ADMIN_ONLY);
      const prisma = makePrisma(doc);
      await expect(new DocumentsService(prisma).findOne(SOCIETY_ID, DOC_ID, false)).resolves.toEqual(doc);
      // Admin query must NOT include accessLevel filter
      const [callArg] = (prisma.document.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where).not.toHaveProperty('accessLevel');
    });

    it('throws NotFoundException when document does not exist', async () => {
      await expect(new DocumentsService(makePrisma(null)).findOne(SOCIETY_ID, DOC_ID, false))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('resident access (forResident = true)', () => {
    it('returns a PUBLIC document to a resident', async () => {
      const doc = makeDoc(DocumentAccessLevel.PUBLIC);
      await expect(new DocumentsService(makePrisma(doc)).findOne(SOCIETY_ID, DOC_ID, true)).resolves.toEqual(doc);
    });

    it('returns a RESIDENTS_ONLY document to a resident', async () => {
      const doc = makeDoc(DocumentAccessLevel.RESIDENTS_ONLY);
      await expect(new DocumentsService(makePrisma(doc)).findOne(SOCIETY_ID, DOC_ID, true)).resolves.toEqual(doc);
    });

    it('throws NotFoundException for ADMIN_ONLY document — resident cannot access', async () => {
      // DB returns null because accessLevel filter excludes ADMIN_ONLY
      await expect(new DocumentsService(makePrisma(null)).findOne(SOCIETY_ID, DOC_ID, true))
        .rejects.toThrow('Document not found');
    });

    it('includes accessLevel filter when forResident is true', async () => {
      const prisma = makePrisma(makeDoc(DocumentAccessLevel.PUBLIC));
      await new DocumentsService(prisma).findOne(SOCIETY_ID, DOC_ID, true);
      const [callArg] = (prisma.document.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where.accessLevel).toMatchObject({
        in: expect.arrayContaining([DocumentAccessLevel.PUBLIC, DocumentAccessLevel.RESIDENTS_ONLY]),
      });
      expect(callArg.where.accessLevel.in).not.toContain(DocumentAccessLevel.ADMIN_ONLY);
    });

    it('omits accessLevel filter when forResident is false', async () => {
      const prisma = makePrisma(makeDoc(DocumentAccessLevel.ADMIN_ONLY));
      await new DocumentsService(prisma).findOne(SOCIETY_ID, DOC_ID, false);
      const [callArg] = (prisma.document.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where).not.toHaveProperty('accessLevel');
    });
  });

  describe('society scoping', () => {
    it('always filters by societyId and isActive', async () => {
      const prisma = makePrisma(makeDoc(DocumentAccessLevel.PUBLIC));
      await new DocumentsService(prisma).findOne(SOCIETY_ID, DOC_ID, true);
      const [callArg] = (prisma.document.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where).toMatchObject({ societyId: SOCIETY_ID, id: DOC_ID, isActive: true });
    });
  });
});
