/**
 * DEFECT-7: documents.findOne resident access-level visibility unit tests.
 * Extended for FLAT_PRIVATE: a document visible only to whoever's own
 * flatId matches the document's flatId, regardless of role — an admin
 * gets no special access to another flat's private documents, and does
 * get access to their own if they're also a resident there.
 */

import { DocumentsService } from './documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { SftpStorageService } from './sftp-storage.service';
import { NotFoundException } from '@nestjs/common';
import { DocumentAccessLevel } from '@prisma/client';

const SOCIETY_ID = 'society-x';
const DOC_ID = 'doc-1';
const FLAT_ID = 'flat-1';

function makeDoc(accessLevel: DocumentAccessLevel, flatId: string | null = null) {
  return { id: DOC_ID, societyId: SOCIETY_ID, isActive: true, accessLevel, flatId, title: 'Test Doc' };
}

function makePrisma(docResult: unknown) {
  return {
    document: { findFirst: jest.fn().mockResolvedValue(docResult) },
  } as unknown as PrismaService;
}

// findOne()/findAll() never touch storage — a bare stub is enough.
const NULL_STORAGE = {} as unknown as SftpStorageService;

describe('DocumentsService — findOne resident visibility (DEFECT-7)', () => {
  describe('admin access (forResident = false)', () => {
    it('returns a PUBLIC document', async () => {
      const doc = makeDoc(DocumentAccessLevel.PUBLIC);
      await expect(new DocumentsService(makePrisma(doc), NULL_STORAGE).findOne(SOCIETY_ID, DOC_ID, false, undefined)).resolves.toEqual(doc);
    });

    it('returns a RESIDENTS_ONLY document', async () => {
      const doc = makeDoc(DocumentAccessLevel.RESIDENTS_ONLY);
      await expect(new DocumentsService(makePrisma(doc), NULL_STORAGE).findOne(SOCIETY_ID, DOC_ID, false, undefined)).resolves.toEqual(doc);
    });

    it('returns an ADMIN_ONLY document (admins are not restricted to PUBLIC/RESIDENTS_ONLY)', async () => {
      const doc = makeDoc(DocumentAccessLevel.ADMIN_ONLY);
      const prisma = makePrisma(doc);
      await expect(new DocumentsService(prisma, NULL_STORAGE).findOne(SOCIETY_ID, DOC_ID, false, undefined)).resolves.toEqual(doc);
      const [callArg] = (prisma.document.findFirst as jest.Mock).mock.calls[0];
      // Not restricted to PUBLIC/RESIDENTS_ONLY, but FLAT_PRIVATE must still
      // be excluded from this branch — that's what the second OR arm is for.
      expect(callArg.where.OR[0].accessLevel).toEqual({ not: DocumentAccessLevel.FLAT_PRIVATE });
    });

    it('throws NotFoundException when document does not exist', async () => {
      await expect(new DocumentsService(makePrisma(null), NULL_STORAGE).findOne(SOCIETY_ID, DOC_ID, false, undefined))
        .rejects.toThrow(NotFoundException);
    });
  });

  describe('resident access (forResident = true)', () => {
    it('returns a PUBLIC document to a resident', async () => {
      const doc = makeDoc(DocumentAccessLevel.PUBLIC);
      await expect(new DocumentsService(makePrisma(doc), NULL_STORAGE).findOne(SOCIETY_ID, DOC_ID, true, undefined)).resolves.toEqual(doc);
    });

    it('returns a RESIDENTS_ONLY document to a resident', async () => {
      const doc = makeDoc(DocumentAccessLevel.RESIDENTS_ONLY);
      await expect(new DocumentsService(makePrisma(doc), NULL_STORAGE).findOne(SOCIETY_ID, DOC_ID, true, undefined)).resolves.toEqual(doc);
    });

    it('throws NotFoundException for ADMIN_ONLY document — resident cannot access', async () => {
      // DB returns null because accessLevel filter excludes ADMIN_ONLY
      await expect(new DocumentsService(makePrisma(null), NULL_STORAGE).findOne(SOCIETY_ID, DOC_ID, true, undefined))
        .rejects.toThrow('Document not found');
    });

    it('restricts the non-private branch to PUBLIC/RESIDENTS_ONLY when forResident is true', async () => {
      const prisma = makePrisma(makeDoc(DocumentAccessLevel.PUBLIC));
      await new DocumentsService(prisma, NULL_STORAGE).findOne(SOCIETY_ID, DOC_ID, true, undefined);
      const [callArg] = (prisma.document.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where.OR[0].accessLevel).toMatchObject({
        in: expect.arrayContaining([DocumentAccessLevel.PUBLIC, DocumentAccessLevel.RESIDENTS_ONLY]),
      });
      expect(callArg.where.OR[0].accessLevel.in).not.toContain(DocumentAccessLevel.ADMIN_ONLY);
    });

    it('does not restrict to PUBLIC/RESIDENTS_ONLY when forResident is false', async () => {
      const prisma = makePrisma(makeDoc(DocumentAccessLevel.ADMIN_ONLY));
      await new DocumentsService(prisma, NULL_STORAGE).findOne(SOCIETY_ID, DOC_ID, false, undefined);
      const [callArg] = (prisma.document.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where.OR[0].accessLevel).not.toMatchObject({ in: expect.anything() });
    });
  });

  describe('FLAT_PRIVATE visibility', () => {
    it('has no flat-private OR branch when the caller has no flatId', async () => {
      const prisma = makePrisma(makeDoc(DocumentAccessLevel.PUBLIC));
      await new DocumentsService(prisma, NULL_STORAGE).findOne(SOCIETY_ID, DOC_ID, true, undefined);
      const [callArg] = (prisma.document.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where.OR).toHaveLength(1);
    });

    it('adds a flat-private OR branch scoped to the caller\'s own flatId', async () => {
      const doc = makeDoc(DocumentAccessLevel.FLAT_PRIVATE, FLAT_ID);
      const prisma = makePrisma(doc);
      await expect(
        new DocumentsService(prisma, NULL_STORAGE).findOne(SOCIETY_ID, DOC_ID, true, FLAT_ID),
      ).resolves.toEqual(doc);
      const [callArg] = (prisma.document.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where.OR).toContainEqual({
        accessLevel: DocumentAccessLevel.FLAT_PRIVATE,
        flatId: FLAT_ID,
      });
    });

    it('an admin with a flatId only gets the flat-private carve-out for that flat, not the general branch', async () => {
      // Same query shape as a resident's — admin-vs-resident only changes
      // the first OR branch's accessLevel restriction, never the second.
      const prisma = makePrisma(makeDoc(DocumentAccessLevel.FLAT_PRIVATE, FLAT_ID));
      await new DocumentsService(prisma, NULL_STORAGE).findOne(SOCIETY_ID, DOC_ID, false, FLAT_ID);
      const [callArg] = (prisma.document.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where.OR).toContainEqual({
        accessLevel: DocumentAccessLevel.FLAT_PRIVATE,
        flatId: FLAT_ID,
      });
      expect(callArg.where.OR[0].accessLevel).toEqual({ not: DocumentAccessLevel.FLAT_PRIVATE });
    });
  });

  describe('society scoping', () => {
    it('always filters by societyId and isActive', async () => {
      const prisma = makePrisma(makeDoc(DocumentAccessLevel.PUBLIC));
      await new DocumentsService(prisma, NULL_STORAGE).findOne(SOCIETY_ID, DOC_ID, true, undefined);
      const [callArg] = (prisma.document.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where).toMatchObject({ societyId: SOCIETY_ID, id: DOC_ID, isActive: true });
    });
  });
});
