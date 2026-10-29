-- Deliveries: a resident's "a delivery is coming" instruction, and the parcels
-- the gate holds for a flat. Idempotent, matching the repo's hand-written
-- migrations. Purely additive: no existing row, column or constraint changes.

DO $$ BEGIN
  CREATE TYPE "DeliveryInstruction" AS ENUM ('ALLOW_ENTRY', 'LEAVE_AT_GATE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "DeliveryExpectationStatus" AS ENUM ('ACTIVE', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ParcelStatus" AS ENUM ('RECEIVED', 'COLLECTED', 'RETURNED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "delivery_expectations" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "flatId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "company" TEXT NOT NULL,
  "instruction" "DeliveryInstruction" NOT NULL,
  "note" TEXT,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "maxUses" INTEGER NOT NULL DEFAULT 1,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "status" "DeliveryExpectationStatus" NOT NULL DEFAULT 'ACTIVE',
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "delivery_expectations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_expectations_window_valid" CHECK ("validUntil" > "validFrom"),
  CONSTRAINT "delivery_expectations_uses_valid" CHECK ("maxUses" >= 1 AND "usedCount" >= 0)
);

CREATE TABLE IF NOT EXISTS "parcels" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "flatId" TEXT NOT NULL,
  "courier" TEXT NOT NULL,
  "recipientName" TEXT,
  "note" TEXT,
  "status" "ParcelStatus" NOT NULL DEFAULT 'RECEIVED',
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "receivedById" TEXT,
  "closedAt" TIMESTAMP(3),
  "closedById" TEXT,
  "collectedByName" TEXT,
  "clientRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "parcels_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "delivery_expectations_societyId_flatId_status_idx" ON "delivery_expectations"("societyId", "flatId", "status");
CREATE INDEX IF NOT EXISTS "delivery_expectations_societyId_validUntil_idx" ON "delivery_expectations"("societyId", "validUntil");
CREATE UNIQUE INDEX IF NOT EXISTS "parcels_societyId_clientRequestId_key" ON "parcels"("societyId", "clientRequestId");
CREATE INDEX IF NOT EXISTS "parcels_societyId_status_idx" ON "parcels"("societyId", "status");
CREATE INDEX IF NOT EXISTS "parcels_flatId_receivedAt_idx" ON "parcels"("flatId", "receivedAt");
CREATE INDEX IF NOT EXISTS "parcels_societyId_receivedAt_idx" ON "parcels"("societyId", "receivedAt");

DO $$ BEGIN
  ALTER TABLE "delivery_expectations" ADD CONSTRAINT "delivery_expectations_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "delivery_expectations" ADD CONSTRAINT "delivery_expectations_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "parcels" ADD CONSTRAINT "parcels_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "parcels" ADD CONSTRAINT "parcels_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
