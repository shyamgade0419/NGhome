import { Prisma } from '@prisma/client';
import { hasSocietyId, isBlocking, onDeleteOf, purgeOrder, unscopedBlockers } from './society-purge.plan';

type Model = Prisma.DMMF.Model;
const models = Prisma.dmmf.datamodel.models;

const fk = (m: Model) => m.fields.filter((f) => f.kind === 'object' && f.relationFromFields && f.relationFromFields.length > 0);

describe('society purge plan (derived from the real Prisma schema)', () => {
  const order = purgeOrder();
  const scoped = models.filter(hasSocietyId).map((m) => m.name);

  it('purges every table that has a societyId — and only those', () => {
    expect([...order].sort()).toEqual([...scoped].sort());
  });

  it('removes a row that blocks its parent before that parent', () => {
    const position = new Map(order.map((n, i) => [n, i]));
    const violations: string[] = [];
    for (const child of models.filter(hasSocietyId)) {
      for (const f of fk(child)) {
        if (f.type === child.name || !position.has(f.type) || !isBlocking(f)) continue;
        if (position.get(child.name)! > position.get(f.type)!) violations.push(`${child.name} must precede ${f.type}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('never relies on cascade for a child that itself blocks a purged table', () => {
    expect(unscopedBlockers()).toEqual([]);
  });

  // The guard that makes a new table impossible to forget: anything without a
  // societyId has to be accounted for, either as a cascade child of a purged
  // table or as one of the few tables that are not society data at all.
  const NOT_SOCIETY_DATA = ['User', 'Society', 'PlatformSettings', 'PushToken', 'PasswordResetToken'];

  it('accounts for every table that has no societyId', () => {
    const reachable = new Set(scoped);
    // Cascade children of purged tables, followed to any depth.
    let grew = true;
    while (grew) {
      grew = false;
      for (const m of models) {
        if (reachable.has(m.name)) continue;
        const viaCascade = fk(m).some((f) => f.isRequired && onDeleteOf(f) === 'Cascade' && reachable.has(f.type));
        if (viaCascade) {
          reachable.add(m.name);
          grew = true;
        }
      }
    }
    const unaccounted = models.map((m) => m.name).filter((n) => !reachable.has(n) && !NOT_SOCIETY_DATA.includes(n));
    expect(unaccounted).toEqual([]);
  });

  it('keeps the user-owned tables out of the societyId purge (they go with the user)', () => {
    for (const name of ['PushToken', 'PasswordResetToken']) {
      const m = models.find((x) => x.name === name)!;
      expect(order).not.toContain(name);
      expect(fk(m).every((f) => f.type === 'User' && onDeleteOf(f) === 'Cascade')).toBe(true);
    }
  });

  describe('ordering rules on a synthetic schema', () => {
    const field = (name: string, kind: 'scalar' | 'object', extra: Partial<Prisma.DMMF.Field> = {}) =>
      ({ name, kind, type: kind === 'scalar' ? 'String' : name, isRequired: true, isList: false, ...extra }) as Prisma.DMMF.Field;
    const model = (name: string, ...fields: Prisma.DMMF.Field[]) =>
      ({ name, fields: [field('societyId', 'scalar'), ...fields] }) as unknown as Model;
    const ref = (target: string, onDelete?: string) =>
      field('rel' + target, 'object', { type: target, relationFromFields: ['x'], relationOnDelete: onDelete as any });

    it('puts a restricting child ahead of its parent', () => {
      expect(purgeOrder([model('Parent'), model('Child', ref('Parent'))])).toEqual(['Child', 'Parent']);
    });

    it('does not order around a cascading child', () => {
      expect(purgeOrder([model('Parent'), model('Child', ref('Parent', 'Cascade'))])).toEqual(['Parent', 'Child']);
    });

    it('treats an optional relation with no stated action as non-blocking (SetNull)', () => {
      const optional = field('relParent', 'object', { type: 'Parent', relationFromFields: ['x'], isRequired: false });
      expect(purgeOrder([model('Parent'), model('Child', optional)])).toEqual(['Parent', 'Child']);
    });

    it('refuses an impossible plan instead of guessing', () => {
      const a = model('A', ref('B'));
      const b = model('B', ref('A'));
      expect(() => purgeOrder([a, b])).toThrow(/cycle/i);
    });
  });
});
