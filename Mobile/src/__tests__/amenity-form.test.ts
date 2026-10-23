import { Amenity } from '@/api/endpoints/amenities.api';
import { AmenityForm, EMPTY_FORM, buildAmenityPayload, formFromAmenity } from '@/utils/amenity-form';

const form = (overrides: Partial<AmenityForm> = {}): AmenityForm => ({ ...EMPTY_FORM, name: 'Clubhouse', ...overrides });
const errorOf = (overrides: Partial<AmenityForm>) => {
  const r = buildAmenityPayload(form(overrides));
  return r.ok ? null : r.error;
};

describe('buildAmenityPayload — valid forms', () => {
  it('turns the defaults into the payload the API expects', () => {
    const r = buildAmenityPayload(form());
    expect(r).toEqual({
      ok: true,
      payload: {
        name: 'Clubhouse',
        description: '',
        rules: '',
        bookingMode: 'INSTANT',
        slotMinutes: 60,
        opensAtMin: 360,
        closesAtMin: 1320,
        maxAdvanceDays: 30,
        monthlyCapPerFlat: null,
        cancelBeforeHours: 24,
        capacity: 1,
        maxSlotsPerBooking: 1,
        fee: 0,
        isActive: true,
      },
    });
  });

  it('trims text and parses numbers, times and the fee', () => {
    const r = buildAmenityPayload(
      form({ name: '  Party Hall ', opens: '9:30', closes: '23:00', slotMinutes: '120', maxSlots: '3', monthlyCap: '2', fee: '1500.50', bookingMode: 'NEEDS_APPROVAL' }),
    );
    expect(r.ok && r.payload).toMatchObject({
      name: 'Party Hall',
      opensAtMin: 570,
      closesAtMin: 1380,
      slotMinutes: 120,
      maxSlotsPerBooking: 3,
      monthlyCapPerFlat: 2,
      fee: 1500.5,
      bookingMode: 'NEEDS_APPROVAL',
    });
  });

  it('sends null for a blank monthly limit, so editing can remove one', () => {
    const r = buildAmenityPayload(form({ monthlyCap: '   ' }));
    expect(r.ok && r.payload.monthlyCapPerFlat).toBeNull();
  });

  it('treats a blank fee as free', () => {
    const r = buildAmenityPayload(form({ fee: '' }));
    expect(r.ok && r.payload.fee).toBe(0);
  });

  it('accepts closing at midnight', () => {
    const r = buildAmenityPayload(form({ closes: '24:00' }));
    expect(r.ok && r.payload.closesAtMin).toBe(1440);
  });

  it('carries the active switch through for an edit', () => {
    const r = buildAmenityPayload(form({ isActive: false }));
    expect(r.ok && r.payload.isActive).toBe(false);
  });
});

describe('buildAmenityPayload — mistakes it catches at the field', () => {
  it.each([
    [{ name: '   ' }, /name/i],
    [{ name: 'x'.repeat(81) }, /too long/],
    [{ opens: '6am' }, /Opening time/],
    [{ closes: '' }, /Closing time/],
    [{ opens: '24:00', closes: '24:00' }, /before midnight/],
    [{ opens: '10:00', closes: '10:00' }, /after opening/],
    [{ opens: '10:00', closes: '08:00' }, /after opening/],
    [{ slotMinutes: '5' }, /Slot length/],
    [{ slotMinutes: 'abc' }, /whole number/],
    [{ slotMinutes: '1.5' }, /whole number/],
    [{ opens: '06:00', closes: '06:30', slotMinutes: '60' }, /longer than the time/],
    [{ capacity: '0' }, /Bookings per slot/],
    [{ maxSlots: '0' }, /Slots per booking/],
    [{ opens: '06:00', closes: '08:00', slotMinutes: '60', maxSlots: '3' }, /longest booking/],
    [{ advanceDays: '0' }, /Days ahead/],
    [{ advanceDays: '400' }, /Days ahead/],
    [{ cancelHours: '-1' }, /whole number/],
    [{ monthlyCap: '0' }, /Monthly limit/],
    [{ monthlyCap: 'two' }, /whole number/],
    [{ fee: '-5' }, /Fee/],
    [{ fee: '10.123' }, /Fee/],
    [{ fee: '₹500' }, /Fee/],
    [{ fee: '2000000' }, /too large/],
  ])('%j', (overrides, message) => {
    expect(errorOf(overrides as Partial<AmenityForm>)).toMatch(message as RegExp);
  });
});

describe('formFromAmenity', () => {
  const amenity: Amenity = {
    id: 'a1',
    name: 'Tennis court',
    description: null,
    rules: 'Non-marking shoes only.',
    bookingMode: 'NEEDS_APPROVAL',
    slotMinutes: 90,
    opensAtMin: 390,
    closesAtMin: 1290,
    maxAdvanceDays: 14,
    monthlyCapPerFlat: 4,
    cancelBeforeHours: 12,
    capacity: 2,
    maxSlotsPerBooking: 2,
    fee: '250.00',
    isActive: false,
  };

  it('fills every field from the saved amenity', () => {
    expect(formFromAmenity(amenity)).toEqual({
      name: 'Tennis court',
      description: '',
      rules: 'Non-marking shoes only.',
      bookingMode: 'NEEDS_APPROVAL',
      opens: '06:30',
      closes: '21:30',
      slotMinutes: '90',
      capacity: '2',
      maxSlots: '2',
      advanceDays: '14',
      monthlyCap: '4',
      cancelHours: '12',
      fee: '250',
      isActive: false,
    });
  });

  it('shows no fee or limit when there is none', () => {
    const f = formFromAmenity({ ...amenity, fee: null, monthlyCapPerFlat: null });
    expect(f.fee).toBe('');
    expect(f.monthlyCap).toBe('');
  });

  it('round-trips: loading an amenity into the form and building it back gives the same rules', () => {
    const r = buildAmenityPayload(formFromAmenity(amenity));
    expect(r.ok && r.payload).toMatchObject({
      slotMinutes: 90,
      opensAtMin: 390,
      closesAtMin: 1290,
      capacity: 2,
      maxSlotsPerBooking: 2,
      monthlyCapPerFlat: 4,
      fee: 250,
      isActive: false,
    });
  });
});
