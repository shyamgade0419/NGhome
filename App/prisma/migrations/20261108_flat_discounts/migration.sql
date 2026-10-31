-- Standing discounts for a flat: a fixed amount or a percentage off its maintenance on every bill
-- generated while the discount is in force. Idempotent and additive.
DO $$ BEGIN
  CREATE TYPE "FlatDiscountType" AS ENUM ('FIXED', 'PERCENT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "flat_discounts" (
  "id"            TEXT NOT NULL,
  "societyId"     TEXT NOT NULL,
  "flatId"        TEXT NOT NULL,
  "type"          "FlatDiscountType" NOT NULL,
  "value"         DECIMAL(12,2) NOT NULL,
  "reason"        TEXT NOT NULL,
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo"   TIMESTAMP(3),
  "isActive"      BOOLEAN NOT NULL DEFAULT true,
  "createdById"   TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "flat_discounts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "flat_discounts_value_positive" CHECK ("value" > 0),
  CONSTRAINT "flat_discounts_percent_max" CHECK ("type" <> 'PERCENT' OR "value" <= 100),
  CONSTRAINT "flat_discounts_range" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);

CREATE INDEX IF NOT EXISTS "flat_discounts_societyId_idx" ON "flat_discounts"("societyId");
CREATE INDEX IF NOT EXISTS "flat_discounts_flatId_idx" ON "flat_discounts"("flatId");

DO $$ BEGIN
  ALTER TABLE "flat_discounts" ADD CONSTRAINT "flat_discounts_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
