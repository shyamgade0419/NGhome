import {
  MAX_VEHICLES_PER_FLAT, MIN_LOOKUP, SLOT_FOR_LABEL, VEHICLE_KINDS, canLookup, fitsSlot, formatPlate, isValidPlate, kindLabel, parkedAt,
  tidyPlate, vehicleSubtitle, vehiclesForSlot,
} from '@/utils/vehicles';

describe('plates', () => {
  it('tidies what is typed the way the server does: upper case, letters and digits only', () => {
    expect(tidyPlate('ts 09 ab-1234')).toBe('TS09AB1234');
    expect(tidyPlate(' ka.01 mj ')).toBe('KA01MJ');
    expect(tidyPlate('%_!')).toBe('');
    expect(tidyPlate('A'.repeat(20))).toHaveLength(12);
  });

  it.each([
    ['TS09AB1234', true],
    ['ts 09 ab 1234', true],
    ['1234', true],
    ['AB1', false],
    ['', false],
    ['!!!', false],
  ])('%j is a valid plate: %s', (text, ok) => expect(isValidPlate(text)).toBe(ok));

  it('shows an Indian plate the way it reads, and anything else as it is', () => {
    expect(formatPlate('TS09AB1234')).toBe('TS09 AB 1234');
    expect(formatPlate('KA01M4455')).toBe('KA01 M 4455');
    expect(formatPlate('1234')).toBe('1234');
    expect(formatPlate('BH22AA0001A')).toBe('BH22AA0001A');
  });
});

describe('the gate lookup', () => {
  it('needs at least three real characters, so it cannot list every vehicle', () => {
    expect(MIN_LOOKUP).toBe(3);
    expect(canLookup('12')).toBe(false);
    expect(canLookup('123')).toBe(true);
    expect(canLookup('   ')).toBe(false);
    expect(canLookup('% _ %')).toBe(false);
    expect(canLookup('ab-1')).toBe(true);
  });
});

describe('which vehicle fits which slot (mirrors the server)', () => {
  it.each([
    ['CAR', 'CAR', true],
    ['CAR', 'TWO_WHEELER', false],
    ['CAR', 'ANY', true],
    ['TWO_WHEELER', 'TWO_WHEELER', true],
    ['CYCLE', 'TWO_WHEELER', true],
    ['TWO_WHEELER', 'CAR', false],
    ['OTHER', 'ANY', true],
    ['OTHER', 'CAR', false],
  ])('a %s in a %s slot -> %s', (kind, slotFor, expected) => expect(fitsSlot(kind as any, slotFor as any)).toBe(expected));

  it('offers only the household vehicles that fit, keeping their details', () => {
    const vs = [
      { id: 'a', kind: 'CAR' as const, plate: 'TS09AB0001' },
      { id: 'b', kind: 'TWO_WHEELER' as const, plate: 'TS09AB0002' },
      { id: 'c', kind: 'CYCLE' as const, plate: 'TS09AB0003' },
    ];
    expect(vehiclesForSlot(vs, { slotFor: 'CAR' }).map((v) => v.plate)).toEqual(['TS09AB0001']);
    expect(vehiclesForSlot(vs, { slotFor: 'TWO_WHEELER' }).map((v) => v.id)).toEqual(['b', 'c']);
    expect(vehiclesForSlot(vs, { slotFor: 'ANY' })).toHaveLength(3);
  });
});

describe('wording', () => {
  it('has a label for every kind and slot type', () => {
    expect(VEHICLE_KINDS.map((k) => k.value)).toEqual(['CAR', 'TWO_WHEELER', 'CYCLE', 'OTHER']);
    for (const k of VEHICLE_KINDS) expect(kindLabel(k.value)).toBe(k.label);
    expect(SLOT_FOR_LABEL).toEqual({ CAR: 'Car slot', TWO_WHEELER: 'Two-wheeler slot', ANY: 'Any vehicle' });
  });

  it('describes a vehicle by make and colour, or by kind when nothing else is known', () => {
    expect(vehicleSubtitle({ kind: 'CAR', make: 'Maruti Swift', colour: 'White' })).toBe('Maruti Swift · White');
    expect(vehicleSubtitle({ kind: 'CAR', make: null, colour: 'Red' })).toBe('Red');
    expect(vehicleSubtitle({ kind: 'CYCLE', make: null, colour: null })).toBe('Cycle');
  });

  it('says where a vehicle is parked, or that it is not', () => {
    expect(parkedAt({ slots: [] })).toBeNull();
    expect(parkedAt({ slots: [{ id: '1', code: 'B1-12' }] })).toBe('Slot B1-12');
    expect(parkedAt({ slots: [{ id: '2', code: 'B1-13' }, { id: '1', code: 'B1-12' }] })).toBe('Slots B1-12, B1-13');
  });

  it('matches the server limit of six vehicles per flat', () => {
    expect(MAX_VEHICLES_PER_FLAT).toBe(6);
  });
});
