import { Prisma } from '@prisma/client';

/**
 * Spends one use of a flat's "let the delivery up" instruction, if it has one. The choice of
 * instruction and the spend are ONE statement: the outer WHERE repeats the conditions, so when two
 * deliveries arrive together for a flat with a single use left, Postgres re-checks the row after
 * the first takes it and the second gets nothing.
 *
 * Time is judged on the database's own clock in UTC, never a bound JavaScript Date (see
 * VisitorsService.scanCode for why: a bound Date shifts every window by the session's offset).
 *
 * Run it inside the same transaction that records the delivery, so a failed record spends nothing.
 */
export async function consumeAllowEntry(
  tx: Pick<Prisma.TransactionClient, '$queryRaw'>,
  societyId: string,
  flatId: string,
): Promise<{ id: string; company: string } | null> {
  const rows = await tx.$queryRaw<{ id: string; company: string }[]>(
    Prisma.sql`
      UPDATE "delivery_expectations"
         SET "usedCount" = "usedCount" + 1, "updatedAt" = (NOW() AT TIME ZONE 'UTC')
       WHERE "id" = (
               SELECT "id" FROM "delivery_expectations"
                WHERE "societyId" = ${societyId}
                  AND "flatId" = ${flatId}
                  AND "instruction" = 'ALLOW_ENTRY'
                  AND "status" = 'ACTIVE'
                  AND "validFrom" <= (NOW() AT TIME ZONE 'UTC')
                  AND "validUntil" >= (NOW() AT TIME ZONE 'UTC')
                  AND "usedCount" < "maxUses"
                ORDER BY "validUntil" ASC
                LIMIT 1)
         AND "status" = 'ACTIVE'
         AND "validFrom" <= (NOW() AT TIME ZONE 'UTC')
         AND "validUntil" >= (NOW() AT TIME ZONE 'UTC')
         AND "usedCount" < "maxUses"
      RETURNING "id", "company"`,
  );
  return rows[0] ?? null;
}
