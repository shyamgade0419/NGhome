-- Advance credit: money a flat has paid ahead of what it owed, applied to its next bill when
-- that is published. Idempotent and additive: every flat starts at zero.

ALTER TABLE "flats" ADD COLUMN IF NOT EXISTS "creditBalance" DECIMAL(12,2) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE "flats" ADD CONSTRAINT "flats_creditBalance_nonneg" CHECK ("creditBalance" >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "flat_credit_entries" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "flatId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "kind" TEXT NOT NULL,
  "paymentId" TEXT,
  "billId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "flat_credit_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "flat_credit_entries_flatId_idx" ON "flat_credit_entries"("flatId");
CREATE INDEX IF NOT EXISTS "flat_credit_entries_billId_idx" ON "flat_credit_entries"("billId");
CREATE INDEX IF NOT EXISTS "flat_credit_entries_societyId_idx" ON "flat_credit_entries"("societyId");

DO $$ BEGIN
  ALTER TABLE "flat_credit_entries" ADD CONSTRAINT "flat_credit_entries_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
