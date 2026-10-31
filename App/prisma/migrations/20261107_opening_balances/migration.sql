-- Opening balances: what a flat owed before it moved to NG Home from paper or Excel.
-- They are ordinary bills in one special billing period (kind OPENING), so settlement, arrears, the
-- statement and the dues report need no special case. Idempotent and additive: every existing period is
-- REGULAR.
DO $$ BEGIN
  CREATE TYPE "BillingPeriodKind" AS ENUM ('REGULAR', 'OPENING');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "billing_periods" ADD COLUMN IF NOT EXISTS "kind" "BillingPeriodKind" NOT NULL DEFAULT 'REGULAR';

-- Only one opening period per society.
CREATE UNIQUE INDEX IF NOT EXISTS "billing_periods_one_opening_per_society"
  ON "billing_periods" ("societyId") WHERE "kind" = 'OPENING';
