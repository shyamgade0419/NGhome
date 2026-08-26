/**
 * DEFECT-7: meetings.findOne resident visibility unit tests.
 */

import { MeetingsService } from './meetings.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';

const SOCIETY_ID = 'society-x';
const MEETING_ID = 'meeting-1';

const PUBLISHED_MEETING = {
  id: MEETING_ID,
  societyId: SOCIETY_ID,
  isPublished: true,
  title: 'AGM',
  minutes: [],
  attendees: [],
  createdBy: { id: 'u1', firstName: 'Admin', lastName: 'A' },
};

const DRAFT_MEETING = { ...PUBLISHED_MEETING, isPublished: false };

function makePrisma(meetingResult: unknown) {
  return {
    meeting: { findFirst: jest.fn().mockResolvedValue(meetingResult) },
  } as unknown as PrismaService;
}

describe('MeetingsService — findOne resident visibility (DEFECT-7)', () => {
  describe('admin access (forResident = false)', () => {
    it('returns a published meeting', async () => {
      const service = new MeetingsService(makePrisma(PUBLISHED_MEETING));
      await expect(service.findOne(SOCIETY_ID, MEETING_ID, false)).resolves.toEqual(PUBLISHED_MEETING);
    });

    it('returns a draft meeting (admins bypass isPublished filter)', async () => {
      const prisma = makePrisma(DRAFT_MEETING);
      const service = new MeetingsService(prisma);
      await expect(service.findOne(SOCIETY_ID, MEETING_ID, false)).resolves.toEqual(DRAFT_MEETING);
      // Admin query must NOT include isPublished filter
      const [callArg] = (prisma.meeting.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where).not.toHaveProperty('isPublished');
    });

    it('throws NotFoundException when meeting does not exist', async () => {
      const service = new MeetingsService(makePrisma(null));
      await expect(service.findOne(SOCIETY_ID, MEETING_ID, false)).rejects.toThrow(NotFoundException);
    });
  });

  describe('resident access (forResident = true)', () => {
    it('returns a published meeting to a resident', async () => {
      const service = new MeetingsService(makePrisma(PUBLISHED_MEETING));
      await expect(service.findOne(SOCIETY_ID, MEETING_ID, true)).resolves.toEqual(PUBLISHED_MEETING);
    });

    it('throws NotFoundException for a draft meeting — resident cannot access unpublished', async () => {
      // DB returns null because the isPublished:true filter excludes the draft
      const prisma = makePrisma(null);
      const service = new MeetingsService(prisma);
      await expect(service.findOne(SOCIETY_ID, MEETING_ID, true)).rejects.toThrow('Meeting not found');
    });

    it('includes isPublished:true in the DB query when forResident is true', async () => {
      const prisma = makePrisma(PUBLISHED_MEETING);
      const service = new MeetingsService(prisma);
      await service.findOne(SOCIETY_ID, MEETING_ID, true);
      const [callArg] = (prisma.meeting.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where).toMatchObject({ isPublished: true });
    });

    it('omits isPublished filter when forResident is false', async () => {
      const prisma = makePrisma(DRAFT_MEETING);
      const service = new MeetingsService(prisma);
      await service.findOne(SOCIETY_ID, MEETING_ID, false);
      const [callArg] = (prisma.meeting.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where).not.toHaveProperty('isPublished');
    });
  });

  describe('society scoping', () => {
    it('always filters by societyId regardless of resident flag', async () => {
      const prisma = makePrisma(PUBLISHED_MEETING);
      const service = new MeetingsService(prisma);
      await service.findOne(SOCIETY_ID, MEETING_ID, true);
      const [callArg] = (prisma.meeting.findFirst as jest.Mock).mock.calls[0];
      expect(callArg.where).toMatchObject({ societyId: SOCIETY_ID, id: MEETING_ID });
    });
  });
});
