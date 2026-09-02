-- CreateEnum (safe — skips if already exists)
DO $$ BEGIN
  CREATE TYPE "EventStatus" AS ENUM ('PLANNED', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable (safe — skips if already exists)
CREATE TABLE IF NOT EXISTS "events" (
    "id"                   TEXT NOT NULL,
    "societyId"            TEXT NOT NULL,
    "title"                TEXT NOT NULL,
    "description"          TEXT,
    "eventDate"            TIMESTAMP(3) NOT NULL,
    "fundId"               TEXT,
    "estimatedCost"        DECIMAL(12,2),
    "actualCost"           DECIMAL(12,2),
    "status"               "EventStatus" NOT NULL DEFAULT 'PLANNED',
    "isVisibleToResidents" BOOLEAN NOT NULL DEFAULT true,
    "createdById"          TEXT NOT NULL,
    "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (safe)
CREATE INDEX IF NOT EXISTS "events_societyId_idx" ON "events"("societyId");
CREATE INDEX IF NOT EXISTS "events_eventDate_idx" ON "events"("eventDate");

-- AddForeignKey (safe — skips if constraint already exists)
DO $$ BEGIN
  ALTER TABLE "events" ADD CONSTRAINT "events_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "events" ADD CONSTRAINT "events_fundId_fkey"
    FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "events" ADD CONSTRAINT "events_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
