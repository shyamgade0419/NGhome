import * as fs from 'fs';
import * as path from 'path';
import { Prisma } from '@prisma/client';
import { cascadeOwners, hasSocietyId, indirectBlockers, isBlocking, onDeleteOf, purgeOrder } from './society-purge.plan';

type Model = Prisma.DMMF.Model;
const models = Prisma.dmmf.datamodel.models;

const fk = (m: Model) => m.fields.filter((f) => f.kind === 'object' && f.relationFromFields && f.relationFromFields.length > 0);

describe('society purge plan (derived from the real Prisma schema)', () => {
  const order = purgeOrder();
  const position = new Map(order.map((n, i) => [n, i]));
  const scoped = models.filter(hasSocietyId).map((m) => m.name);

  it('purges every table that has a societyId — and only those', () => {
    expect([...order].sort()).toEqual([...scoped].sort());
  });

  it('removes a row that blocks its parent before that parent', () => {
    const violations: string[] = [];
    for (const child of models.filter(hasSocietyId)) {
      for (const f of fk(child)) {
        if (f.type === child.name || !position.has(f.type) || !isBlocking(f)) continue;
        if (position.get(child.name)! > position.get(f.type)!) violations.push(`${child.name} must precede ${f.type}`);
      }
    }
    expect(violations).toEqual([]);
  });

  // A child with no societyId only disappears when its cascade owner is
  // deleted — so that owner has to come first, or the child still blocks.
  it('removes the owner of a cascade-deleted child before the table that child blocks', () => {
    const violations: string[] = [];
    for (const b of indirectBlockers()) {
      expect(b.owners.length).toBeGreaterThan(0); // an unowned blocker could never be cleared
      for (const owner of b.owners) {
        if (position.get(owner)! > position.get(b.blocks)!) violations.push(`${owner} must precede ${b.blocks} (${b.child})`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('knows that line items (owned by a bill) block the billing rule', () => {
    expect(indirectBlockers()).toContainEqual({ child: 'BillLineItem.billingRule', blocks: 'BillingRule', owners: ['MaintenanceBill'] });
    expect(position.get('MaintenanceBill')!).toBeLessThan(position.get('BillingRule')!);
  });

  // The guard that makes a new table impossible to forget: anything without a
  // societyId has to be accounted for, either as a cascade child of a purged
  // table or as one of the few tables that are not society data at all.
  const NOT_SOCIETY_DATA = ['User', 'Society', 'PlatformSettings', 'PlatformMailSettings', 'PushToken', 'PasswordResetToken'];

  it('accounts for every table that has no societyId', () => {
    const unaccounted = models
      .filter((m) => !hasSocietyId(m) && !NOT_SOCIETY_DATA.includes(m.name))
      .filter((m) => cascadeOwners(m, models).length === 0)
      .map((m) => m.name);
    expect(unaccounted).toEqual([]);
  });

  it('keeps the user-owned tables out of the societyId purge (they go with the user)', () => {
    for (const name of ['PushToken', 'PasswordResetToken']) {
      const m = models.find((x) => x.name === name)!;
      expect(order).not.toContain(name);
      expect(fk(m).every((f) => f.type === 'User' && onDeleteOf(f) === 'Cascade')).toBe(true);
    }
  });

  describe('the live database, as the migrations built it', () => {
    // The first production purges failed because the plan trusted the Prisma
    // schema's defaults while the migrations had created different rules:
    // optional relations with no ON DELETE clause (NO ACTION — blocking), where
    // Prisma assumes SetNull. This reads the migration SQL and holds the plan's
    // assumption about every foreign key to what the database really does.
    const dir = path.join(__dirname, '../../prisma/migrations');
    const actual = new Map<string, string>(); // constraint name -> ON DELETE action
    for (const d of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, d, 'migration.sql');
      if (!fs.existsSync(file)) continue;
      const sql = fs.readFileSync(file, 'utf8').replace(/--[^\n]*/g, '');
      for (const stmt of sql.split(';')) {
        if (!/ALTER TABLE/i.test(stmt)) continue;
        for (const part of stmt.split(/ADD CONSTRAINT/i).slice(1)) {
          const m = /^\s*"?(\w+)"?\s+FOREIGN KEY/i.exec(part);
          if (!m) continue;
          const od = /ON DELETE\s+(CASCADE|RESTRICT|SET NULL|NO ACTION|SET DEFAULT)/i.exec(part);
          actual.set(m[1], od ? od[1].toUpperCase() : 'NO ACTION');
        }
      }
    }
    const nameOf = (m: Model, f: Prisma.DMMF.Field) => {
      const col = m.fields.find((x) => x.name === f.relationFromFields![0]);
      return `${m.dbName || m.name}_${col?.dbName || f.relationFromFields![0]}_fkey`;
    };

    it('finds a constraint in the migrations for every foreign key in the schema', () => {
      const missing = models.flatMap((m) => fk(m).filter((f) => !actual.has(nameOf(m, f))).map((f) => nameOf(m, f)));
      expect(missing).toEqual([]);
    });

    it('never plans around a key as harmless when the database actually blocks on it', () => {
      const wrong: string[] = [];
      for (const m of models) {
        for (const f of fk(m)) {
          const db = actual.get(nameOf(m, f));
          const dbBlocks = db === 'RESTRICT' || db === 'NO ACTION';
          if (dbBlocks && !isBlocking(f)) wrong.push(`${m.name}.${f.name}: database ${db}, plan says ${onDeleteOf(f)}`);
        }
      }
      expect(wrong).toEqual([]);
    });
  });

  describe('ordering rules on a synthetic schema', () => {
    const field = (name: string, kind: 'scalar' | 'object', extra: Partial<Prisma.DMMF.Field> = {}) =>
      ({ name, kind, type: kind === 'scalar' ? 'String' : name, isRequired: true, isList: false, ...extra }) as Prisma.DMMF.Field;
    const model = (name: string, ...fields: Prisma.DMMF.Field[]) =>
      ({ name, fields: [field('societyId', 'scalar'), ...fields] }) as unknown as Model;
    const unscoped = (name: string, ...fields: Prisma.DMMF.Field[]) => ({ name, fields }) as unknown as Model;
    const ref = (target: string, onDelete?: string, required = true) =>
      field('rel' + target, 'object', { type: target, relationFromFields: ['x'], relationOnDelete: onDelete as any, isRequired: required });

    it('puts a restricting child ahead of its parent', () => {
      expect(purgeOrder([model('Parent'), model('Child', ref('Parent'))])).toEqual(['Child', 'Parent']);
    });

    it('does not order around a cascading child', () => {
      expect(purgeOrder([model('Parent'), model('Child', ref('Parent', 'Cascade'))])).toEqual(['Parent', 'Child']);
    });

    it('treats an optional relation with no stated action as BLOCKING, as the real database does', () => {
      expect(purgeOrder([model('Parent'), model('Child', ref('Parent', undefined, false))])).toEqual(['Child', 'Parent']);
    });

    it('still lets an explicit SetNull go in any order', () => {
      expect(purgeOrder([model('Parent'), model('Child', ref('Parent', 'SetNull', false))])).toEqual(['Parent', 'Child']);
    });

    it('orders the owner of an unscoped blocking child ahead of what it blocks', () => {
      // Line.rule blocks Rule; Line is owned (cascade) by Bill. So Bill must go before Rule.
      const rule = model('Rule');
      const bill = model('Bill');
      const line = unscoped('Line', ref('Bill', 'Cascade'), ref('Rule', undefined, false));
      const order = purgeOrder([rule, bill, line]);
      expect(order.indexOf('Bill')).toBeLessThan(order.indexOf('Rule'));
    });

    it('refuses an impossible plan instead of guessing', () => {
      const a = model('A', ref('B'));
      const b = model('B', ref('A'));
      expect(() => purgeOrder([a, b])).toThrow(/cycle/i);
    });
  });
});
