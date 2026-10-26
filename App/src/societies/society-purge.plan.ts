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

/** What the database does to this row when its parent is deleted. */
export function onDeleteOf(f: Field): string {
  return f.relationOnDelete ?? (f.isRequired ? 'Restrict' : 'SetNull');
}

/** Restrict / NoAction block the parent's deletion while this row exists. */
export const isBlocking = (f: Field): boolean => ['Restrict', 'NoAction'].includes(onDeleteOf(f));

export const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Models to purge by `societyId`, children before parents: a row that blocks
 * its parent's deletion (Restrict / NoAction) is removed first. Throws if the
 * blocking relations contain a cycle, which no order could satisfy.
 */
export function purgeOrder(models: readonly Model[] = Prisma.dmmf.datamodel.models): string[] {
  const scoped = models.filter(hasSocietyId);
  const names = scoped.map((m) => m.name);
  const inScope = new Set(names);

  // blockers.get(parent) = children that must be gone before parent can be deleted
  const blockers = new Map<string, Set<string>>(names.map((n) => [n, new Set<string>()]));
  for (const child of scoped) {
    for (const f of child.fields.filter(isForeignKey)) {
      if (f.type !== child.name && inScope.has(f.type) && isBlocking(f)) blockers.get(f.type)!.add(child.name);
    }
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

/**
 * Child tables that carry no societyId but hold a blocking foreign key to a
 * table that does. The purge relies on cascade for such rows, which cannot
 * also be ordered ahead of the table they block — so the spec requires this
 * list to be empty apart from the User references handled separately.
 */
export function unscopedBlockers(models: readonly Model[] = Prisma.dmmf.datamodel.models): string[] {
  const scoped = new Set(models.filter(hasSocietyId).map((m) => m.name));
  const found: string[] = [];
  for (const m of models.filter((x) => !hasSocietyId(x))) {
    for (const f of m.fields.filter(isForeignKey)) {
      if (scoped.has(f.type) && isBlocking(f)) found.push(`${m.name}.${f.name} -> ${f.type}`);
    }
  }
  return found;
}
