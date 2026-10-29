-- Domestic help: a register of the people who work in the society's homes, the
-- flats each works for, and their gate visits (attendance). Idempotent, matching
-- the repo's hand-written migrations. Purely additive: no existing row, column or
-- constraint changes.

DO $$ BEGIN
  CREATE TYPE "HelperRole" AS ENUM ('MAID', 'COOK', 'DRIVER', 'NANNY', 'CLEANER', 'GARDENER', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "HelperStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "domestic_helpers" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT,
  "role" "HelperRole" NOT NULL DEFAULT 'MAID',
  "status" "HelperStatus" NOT NULL DEFAULT 'ACTIVE',
  "codeHash" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3),
  "verifiedById" TEXT,
  "suspendedAt" TIMESTAMP(3),
  "suspendedById" TEXT,
  "suspendedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "domestic_helpers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "domestic_helper_flats" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "helperId" TEXT NOT NULL,
  "flatId" TEXT NOT NULL,
  "addedById" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "domestic_helper_flats_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "domestic_helper_visits" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "helperId" TEXT NOT NULL,
  "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checkedInById" TEXT,
  "method" TEXT NOT NULL,
  "checkedOutAt" TIMESTAMP(3),
  "checkedOutById" TEXT,
  "autoClosed" BOOLEAN NOT NULL DEFAULT false,
  "clientRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "domestic_helper_visits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "domestic_helper_visits_out_after_in" CHECK ("checkedOutAt" IS NULL OR "checkedOutAt" >= "checkedInAt")
);

CREATE UNIQUE INDEX IF NOT EXISTS "domestic_helpers_codeHash_key" ON "domestic_helpers"("codeHash");
CREATE UNIQUE INDEX IF NOT EXISTS "domestic_helpers_societyId_phone_key" ON "domestic_helpers"("societyId", "phone");
CREATE INDEX IF NOT EXISTS "domestic_helpers_societyId_status_idx" ON "domestic_helpers"("societyId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "domestic_helper_flats_helperId_flatId_key" ON "domestic_helper_flats"("helperId", "flatId");
CREATE INDEX IF NOT EXISTS "domestic_helper_flats_societyId_flatId_active_idx" ON "domestic_helper_flats"("societyId", "flatId", "active");
CREATE UNIQUE INDEX IF NOT EXISTS "domestic_helper_visits_societyId_clientRequestId_key" ON "domestic_helper_visits"("societyId", "clientRequestId");
CREATE INDEX IF NOT EXISTS "domestic_helper_visits_societyId_checkedInAt_idx" ON "domestic_helper_visits"("societyId", "checkedInAt");
CREATE INDEX IF NOT EXISTS "domestic_helper_visits_helperId_checkedInAt_idx" ON "domestic_helper_visits"("helperId", "checkedInAt");

-- A helper can be inside only once: at most one open visit each. Prisma cannot express a partial
-- unique index, so it lives only here; the service treats its violation as "already inside".
CREATE UNIQUE INDEX IF NOT EXISTS "domestic_helper_visits_one_open_per_helper"
  ON "domestic_helper_visits"("helperId") WHERE "checkedOutAt" IS NULL;

DO $$ BEGIN
  ALTER TABLE "domestic_helpers" ADD CONSTRAINT "domestic_helpers_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "domestic_helper_flats" ADD CONSTRAINT "domestic_helper_flats_helperId_fkey"
    FOREIGN KEY ("helperId") REFERENCES "domestic_helpers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "domestic_helper_flats" ADD CONSTRAINT "domestic_helper_flats_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "domestic_helper_visits" ADD CONSTRAINT "domestic_helper_visits_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "domestic_helper_visits" ADD CONSTRAINT "domestic_helper_visits_helperId_fkey"
    FOREIGN KEY ("helperId") REFERENCES "domestic_helpers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
