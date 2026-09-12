/**
 * create()/update() trusted buildingId and floorId as opaque strings: a
 * client-supplied floorId was never checked against the building it was
 * meant to belong to. A Floor's own scoping is by buildingId (not
 * societyId directly), so cross-referencing another building's — or,
 * through that, another society's — floor would silently attach its
 * name/number to a flat in this society (findOne includes the full floor
 * row). These tests pin the fix: floorId must resolve inside the flat's
 * own building.
 */

import { NotFoundException } from '@nestjs/common';
import { FlatsService } from './flats.service';
import { PrismaService } from '../prisma/prisma.service';

const SOCIETY_ID = 'society-a';
const BUILDING_ID = 'building-1';
const FLAT_ID = 'flat-1';

const baseDto = {
  buildingId: BUILDING_ID,
  unitNumber: '101',
  flatCode: 'A-101',
};

function makePrisma(opts: { building?: unknown; floor?: unknown; existingFlat?: unknown } = {}) {
  const building = 'building' in opts ? opts.building : { id: BUILDING_ID, societyId: SOCIETY_ID };
  const existingFlat = ('existingFlat' in opts
    ? opts.existingFlat
    : { id: FLAT_ID, societyId: SOCIETY_ID, buildingId: BUILDING_ID, deletedAt: null }) as Record<string, unknown>;

  return {
    building: { findFirst: jest.fn().mockResolvedValue(building) },
    floor: { findFirst: jest.fn().mockResolvedValue(opts.floor) },
    flat: {
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'new-flat', ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...existingFlat, ...data })),
      findFirst: jest.fn().mockResolvedValue(existingFlat),
    },
  } as unknown as PrismaService;
}

describe('FlatsService.create — buildingId and floorId scoping', () => {
  it('refuses a buildingId from another society, and never creates the flat', async () => {
    const prisma = makePrisma({ building: null });
    await expect(
      new FlatsService(prisma).create(SOCIETY_ID, { ...baseDto, buildingId: 'building-from-society-b' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.flat.create).not.toHaveBeenCalled();
  });

  it('refuses a floorId that does not belong to the given building, and never creates the flat', async () => {
    const prisma = makePrisma({ floor: null }); // building exists, floor lookup scoped to it comes back empty
    await expect(
      new FlatsService(prisma).create(SOCIETY_ID, { ...baseDto, floorId: 'floor-from-another-building' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.flat.create).not.toHaveBeenCalled();
    expect((prisma.floor.findFirst as jest.Mock).mock.calls[0][0].where).toEqual({
      id: 'floor-from-another-building',
      buildingId: BUILDING_ID,
    });
  });

  it('accepts a floorId that genuinely belongs to the given building', async () => {
    const prisma = makePrisma({ floor: { id: 'floor-1', buildingId: BUILDING_ID } });
    await new FlatsService(prisma).create(SOCIETY_ID, { ...baseDto, floorId: 'floor-1' });
    expect(prisma.flat.create).toHaveBeenCalled();
  });

  it('skips the floor lookup entirely when no floorId is given', async () => {
    const prisma = makePrisma();
    await new FlatsService(prisma).create(SOCIETY_ID, baseDto);
    expect(prisma.floor.findFirst).not.toHaveBeenCalled();
    expect(prisma.flat.create).toHaveBeenCalled();
  });
});

describe('FlatsService.update — floorId scoping', () => {
  it("refuses a floorId that does not belong to the flat's own building, and never updates", async () => {
    const prisma = makePrisma({ floor: null });
    await expect(
      new FlatsService(prisma).update(SOCIETY_ID, FLAT_ID, { floorId: 'floor-from-another-building' }),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.flat.update).not.toHaveBeenCalled();
  });

  it("accepts a floorId that belongs to the flat's own (unchangeable) building", async () => {
    const prisma = makePrisma({ floor: { id: 'floor-2', buildingId: BUILDING_ID } });
    await new FlatsService(prisma).update(SOCIETY_ID, FLAT_ID, { floorId: 'floor-2' });
    expect(prisma.flat.update).toHaveBeenCalled();
    expect((prisma.floor.findFirst as jest.Mock).mock.calls[0][0].where).toEqual({
      id: 'floor-2',
      buildingId: BUILDING_ID, // the flat's existing building, not client-suppliable here
    });
  });
});
