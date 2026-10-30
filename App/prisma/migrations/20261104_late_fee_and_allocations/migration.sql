-- Late fine once per bill, and how a payment was shared across a flat's bills (oldest first).
-- Idempotent and purely additive.

ALTER TABLE "maintenance_bills" ADD COLUMN IF NOT EXISTS "lateFeeAppliedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "payment_allocations" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "paymentId" TEXT NOT NULL,
  "billId" TEXT NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "payment_allocations_paymentId_idx" ON "payment_allocations"("paymentId");
CREATE INDEX IF NOT EXISTS "payment_allocations_billId_idx" ON "payment_allocations"("billId");
CREATE INDEX IF NOT EXISTS "payment_allocations_societyId_idx" ON "payment_allocations"("societyId");

DO $$ BEGIN
  ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "payment_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_billId_fkey"
    FOREIGN KEY ("billId") REFERENCES "maintenance_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
