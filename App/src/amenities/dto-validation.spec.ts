/**
 * The amenity payloads, run through the exact pipe configuration main.ts uses
 * (see src/common/dto-validation.spec.ts for why that matters): with
 * forbidNonWhitelisted on, a field the apps send but a DTO forgot becomes a
 * 400 on a working form, and one a DTO should refuse must really be refused.
 */

import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { CreateAmenityDto, UpdateAmenityDto } from './dto/amenity.dto';
import { CollectFeeDto, CreateBookingDto, RejectBookingDto } from './dto/booking.dto';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const run = (value: unknown, metatype: any) => pipe.transform(value, { type: 'body', metatype });

describe('CreateAmenityDto', () => {
  it('accepts just a name — every rule has a default', async () => {
    await expect(run({ name: 'Tennis court' }, CreateAmenityDto)).resolves.toMatchObject({ name: 'Tennis court' });
  });

  it('accepts a fully specified amenity', async () => {
    await expect(
      run(
        {
          name: 'Clubhouse',
          description: 'Party hall with kitchen',
          rules: 'No loud music after 10 pm.',
          bookingMode: 'NEEDS_APPROVAL',
          slotMinutes: 120,
          opensAtMin: 540,
          closesAtMin: 1260,
          maxAdvanceDays: 60,
          monthlyCapPerFlat: 2,
          cancelBeforeHours: 48,
          capacity: 1,
          maxSlotsPerBooking: 4,
          fee: 1500.5,
        },
        CreateAmenityDto,
      ),
    ).resolves.toMatchObject({ bookingMode: 'NEEDS_APPROVAL', fee: 1500.5 });
  });

  it.each([
    ['an empty name', { name: '' }],
    ['a name over 80 characters', { name: 'x'.repeat(81) }],
    ['a slot under 15 minutes', { name: 'X', slotMinutes: 5 }],
    ['a slot over 8 hours', { name: 'X', slotMinutes: 600 }],
    ['a negative opening time', { name: 'X', opensAtMin: -1 }],
    ['an opening time past midnight', { name: 'X', opensAtMin: 1440 }],
    ['a closing time past 24:00', { name: 'X', closesAtMin: 1441 }],
    ['zero capacity', { name: 'X', capacity: 0 }],
    ['zero advance days', { name: 'X', maxAdvanceDays: 0 }],
    ['a negative fee', { name: 'X', fee: -1 }],
    ['a fee with paise precision beyond 2 places', { name: 'X', fee: 10.123 }],
    ['an unknown booking mode', { name: 'X', bookingMode: 'MAYBE' }],
    ['a field it does not know about', { name: 'X', societyId: 'someone-elses' }],
  ])('refuses %s', async (_label, body) => {
    await expect(run(body, CreateAmenityDto)).rejects.toThrow(BadRequestException);
  });
});

describe('UpdateAmenityDto', () => {
  it('accepts any subset, including just switching it off', async () => {
    await expect(run({ isActive: false }, UpdateAmenityDto)).resolves.toMatchObject({ isActive: false });
    await expect(run({ fee: 0 }, UpdateAmenityDto)).resolves.toBeDefined();
    await expect(run({}, UpdateAmenityDto)).resolves.toBeDefined();
  });

  it('still applies the same limits to what is sent', async () => {
    await expect(run({ capacity: 0 }, UpdateAmenityDto)).rejects.toThrow(BadRequestException);
    await expect(run({ name: '' }, UpdateAmenityDto)).rejects.toThrow(BadRequestException);
  });
});

describe('CreateBookingDto', () => {
  const base = { amenityId: 'amenity-1', startAt: '2026-11-04T12:30:00.000Z' };

  it('accepts the payload the apps send', async () => {
    await expect(run(base, CreateBookingDto)).resolves.toMatchObject(base);
    await expect(run({ ...base, slots: 2, guestCount: 8, note: 'Birthday' }, CreateBookingDto)).resolves.toBeDefined();
  });

  it.each([
    ['no amenity', { startAt: base.startAt }],
    ['no start time', { amenityId: 'a' }],
    ['a start that is not a date', { ...base, startAt: 'tomorrow evening' }],
    ['zero slots', { ...base, slots: 0 }],
    ['more than 24 slots', { ...base, slots: 25 }],
    ['a negative guest count', { ...base, guestCount: -1 }],
    ['a note over 300 characters', { ...base, note: 'x'.repeat(301) }],
  ])('refuses %s', async (_label, body) => {
    await expect(run(body, CreateBookingDto)).rejects.toThrow(BadRequestException);
  });

  it.each(['flatId', 'userId', 'societyId', 'status', 'feeAmount', 'feeStatus'])(
    'refuses a body that tries to set %s — a resident cannot book for another flat or pick their own fee',
    async (field) => {
      await expect(run({ ...base, [field]: 'x' }, CreateBookingDto)).rejects.toThrow(BadRequestException);
    },
  );
});

describe('RejectBookingDto / CollectFeeDto', () => {
  it('a rejection reason is optional but capped', async () => {
    await expect(run({}, RejectBookingDto)).resolves.toBeDefined();
    await expect(run({ reason: 'Maintenance that day' }, RejectBookingDto)).resolves.toBeDefined();
    await expect(run({ reason: 'x'.repeat(301) }, RejectBookingDto)).rejects.toThrow(BadRequestException);
  });

  it('collecting a fee must say which account', async () => {
    await expect(run({ accountId: 'account-1' }, CollectFeeDto)).resolves.toBeDefined();
    await expect(run({}, CollectFeeDto)).rejects.toThrow(BadRequestException);
  });
});
