/**
 * DEFECT-3: Water reading validation unit tests.
 */

import { WaterService, RecordReadingDto } from './water.service';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const SOCIETY_ID = 'society-test';
const FLAT_ID = 'flat-test';

type PrismaOverrides = {
  flatFindFirst?: unknown;
  billingPeriodFindFirst?: unknown;
  waterConfigFindFirst?: unknown;
};

function makePrisma(overrides: PrismaOverrides = {}): jest.Mocked<Pick<PrismaService, 'flat' | 'billingPeriod' | 'waterBillingConfig' | 'waterMeterReading'>> {
  // Use 'in' check so explicit null overrides are preserved (not fallen back by ??)
  const flatResult = 'flatFindFirst' in overrides ? overrides.flatFindFirst : { id: FLAT_ID };
  const periodResult = 'billingPeriodFindFirst' in overrides ? overrides.billingPeriodFindFirst : null;
  const configResult = 'waterConfigFindFirst' in overrides ? overrides.waterConfigFindFirst : null;
  return {
    flat: { findFirst: jest.fn().mockResolvedValue(flatResult) } as any,
    billingPeriod: { findFirst: jest.fn().mockResolvedValue(periodResult) } as any,
    waterBillingConfig: { findFirst: jest.fn().mockResolvedValue(configResult) } as any,
    waterMeterReading: { create: jest.fn().mockResolvedValue({ id: 'reading-1' }) } as any,
  };
}

function makeService(prismaOverrides = {}): WaterService {
  return new WaterService(makePrisma(prismaOverrides) as any);
}

const baseDto: RecordReadingDto = {
  flatId: FLAT_ID,
  readingDate: '2024-01-15',
  openingReading: 100,
  closingReading: 150,
};

describe('WaterService — reading validation (DEFECT-3)', () => {
  describe('Valid readings', () => {
    it('accepts closing > opening', async () => {
      const service = makeService();
      await expect(service.recordReading(SOCIETY_ID, { ...baseDto, openingReading: 100, closingReading: 150 })).resolves.toBeDefined();
    });

    it('accepts closing === opening (zero consumption)', async () => {
      const service = makeService();
      await expect(service.recordReading(SOCIETY_ID, { ...baseDto, openingReading: 100, closingReading: 100 })).resolves.toBeDefined();
    });

    it('accepts zero opening reading', async () => {
      const service = makeService();
      await expect(service.recordReading(SOCIETY_ID, { ...baseDto, openingReading: 0, closingReading: 50 })).resolves.toBeDefined();
    });
  });

  describe('Invalid readings', () => {
    it('rejects negative opening reading', async () => {
      const service = makeService();
      await expect(
        service.recordReading(SOCIETY_ID, { ...baseDto, openingReading: -10, closingReading: 50 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects negative closing reading', async () => {
      const service = makeService();
      await expect(
        service.recordReading(SOCIETY_ID, { ...baseDto, openingReading: 0, closingReading: -5 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects closing < opening', async () => {
      const service = makeService();
      await expect(
        service.recordReading(SOCIETY_ID, { ...baseDto, openingReading: 150, closingReading: 100 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('includes descriptive error message for reversed readings', async () => {
      const service = makeService();
      await expect(
        service.recordReading(SOCIETY_ID, { ...baseDto, openingReading: 200, closingReading: 100 }),
      ).rejects.toThrow('Closing reading must be greater than or equal to opening reading');
    });

    it('includes descriptive error message for negative readings', async () => {
      const service = makeService();
      await expect(
        service.recordReading(SOCIETY_ID, { ...baseDto, openingReading: -1, closingReading: 50 }),
      ).rejects.toThrow('Water meter readings cannot be negative');
    });
  });

  describe('Flat belongs to society validation (DEFECT-1 cross-check)', () => {
    it('rejects flat not in this society', async () => {
      const service = makeService({ flatFindFirst: null });
      await expect(
        service.recordReading(SOCIETY_ID, baseDto),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('Water config tenant validation (DEFECT-2)', () => {
    it('rejects waterConfigId not found in this society', async () => {
      const service = makeService({ waterConfigFindFirst: null });
      await expect(
        service.recordReading(SOCIETY_ID, { ...baseDto, waterConfigId: 'config-from-other-society' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('allows recording without waterConfigId', async () => {
      const service = makeService();
      await expect(
        service.recordReading(SOCIETY_ID, { ...baseDto }),
      ).resolves.toBeDefined();
    });
  });
});
