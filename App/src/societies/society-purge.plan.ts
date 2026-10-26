import { Prisma } from '@prisma/client';

/**
 * The plan for permanently erasing one society's rows.
 *
 * It is derived from the Prisma schema rather than written out by hand, so a
 * table added later cannot be silently missed: every model with a societyId
 * column is purged, in an order that respects the foreign keys, and
 * society-purge.plan.spec.ts fails if the schema grows a shape this plan
 * does not understand.
 *
 * Tables without a societyId (Floor, BillLineItem, MeetingAttendee, …) are
 * children of a table that has one and go with it through ON DELETE CASCADE.
 */

type Model = Prisma.DMMF.Model;
type Field = Prisma.DMMF.Field;

export const hasSocietyId = (m: Model): boolean => m.fields.some((f) => f.name === 'societyId' && f.kind === 'scalar');

/** A relation field that holds the foreign key (the child side). */
const isForeignKey = (f: Field): boolean => f.kind === 'object' && !!f.relationFromFields && f.relationFromFields.length > 0;

/**
 * What the database does to this row when its parent is deleted.
 *
 * Prisma's own default for an optional relation is SetNull, but the database
 * here was built from hand-written migrations (0_init) that gave those keys
 * no ON DELETE clause at all, i.e. NO ACTION — they BLOCK the parent's
 * deletion. Trusting the schema's default made the first production purges
 * fail with foreign-key errors on any society that had real data. So a
 * relation with no stated action is treated as blocking, whether required or
 * not: ordering children first is correct under either behaviour.
 */
export function onDeleteOf(f: Field): string {
  return f.relationOnDelete ?? (f.isRequired ? 'Restrict' : 'NoAction');
}

/** Restrict / NoAction block the parent's deletion while this row exists. */
export const isBlocking = (f: Field): boolean => ['Restrict', 'NoAction'].includes(onDeleteOf(f));

export const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * The scoped tables whose deletion removes rows of `model` through cascade,
 * following required ON DELETE CASCADE keys upward through any number of
 * unscoped tables (BillLineItem -> MaintenanceBill, Floor -> Building, …).
 */
export function cascadeOwners(model: Model, models: readonly Model[], seen = new Set<string>()): string[] {
  const byName = new Map(models.map((m) => [m.name, m]));
  const owners = new Set<string>();
  for (const f of model.fields.filter(isForeignKey)) {
    if (!f.isRequired || onDeleteOf(f) !== 'Cascade') continue;
    const parent = byName.get(f.type);
    if (!parent || seen.has(parent.name)) continue;
    if (hasSocietyId(parent)) {
      owners.add(parent.name);
    } else {
      seen.add(parent.name);
      cascadeOwners(parent, models, seen).forEach((o) => owners.add(o));
    }
  }
  return [...owners];
}

/**
 * A child that carries no societyId but blocks a purged table. Such rows only
 * disappear when their cascade owner is deleted, so that owner has to be
 * removed before the table they block: BillLineItem blocks BillingRule, so
 * MaintenanceBill, which owns the line items, must go before BillingRule.
 */
export interface IndirectBlocker {
  child: string;
  blocks: string;
  owners: string[];
}

export function indirectBlockers(models: readonly Model[] = Prisma.dmmf.datamodel.models): IndirectBlocker[] {
  const scoped = new Set(models.filter(hasSocietyId).map((m) => m.name));
  const found: IndirectBlocker[] = [];
  for (const m of models.filter((x) => !hasSocietyId(x))) {
    for (const f of m.fields.filter(isForeignKey)) {
      if (!scoped.has(f.type) || !isBlocking(f)) continue;
      const owners = cascadeOwners(m, models).filter((o) => o !== f.type);
      found.push({ child: `${m.name}.${f.name}`, blocks: f.type, owners });
    }
  }
  return found;
}

/**
 * Models to purge by `societyId`, children before parents: a row that blocks
 * its parent's deletion (Restrict / NoAction) is removed first, and so is the
 * owner of any cascade-deleted child that blocks it. Throws if the blocking
 * relations contain a cycle, which no order could satisfy.
 */
export function purgeOrder(models: readonly Model[] = Prisma.dmmf.datamodel.models): string[] {
  const scoped = models.filter(hasSocietyId);
  const names = scoped.map((m) => m.name);
  const inScope = new Set(names);

  // blockers.get(parent) = tables that must be gone before parent can be deleted
  const blockers = new Map<string, Set<string>>(names.map((n) => [n, new Set<string>()]));
  for (const child of scoped) {
    for (const f of child.fields.filter(isForeignKey)) {
      if (f.type !== child.name && inScope.has(f.type) && isBlocking(f)) blockers.get(f.type)!.add(child.name);
    }
  }
  for (const { blocks, owners } of indirectBlockers(models)) {
    for (const owner of owners) blockers.get(blocks)?.add(owner);
  }

  const order: string[] = [];
  const remaining = new Set(names);
  while (remaining.size > 0) {
    // A model is ready once everything that blocks it has been placed.
    const ready = names.filter((n) => remaining.has(n) && [...blockers.get(n)!].every((c) => !remaining.has(c)));
    if (ready.length === 0) {
      throw new Error(`Foreign keys form a cycle among: ${[...remaining].join(', ')}`);
    }
    for (const n of ready) {
      order.push(n);
      remaining.delete(n);
    }
  }
  return order;
}
