-- Vehicles and parking: the vehicles each household has registered, and the society's
-- parking slots with who holds each. Idempotent, matching the repo's hand-written
-- migrations. Purely additive: no existing row, column or constraint changes (the
-- "flats"."parkingSlots" count that billing uses is left exactly as it is).

DO $$ BEGIN
  CREATE TYPE "VehicleKind" AS ENUM ('CAR', 'TWO_WHEELER', 'CYCLE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "SlotFor" AS ENUM ('CAR', 'TWO_WHEELER', 'ANY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "vehicles" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "flatId" TEXT NOT NULL,
  "plate" TEXT NOT NULL,
  "kind" "VehicleKind" NOT NULL,
  "make" TEXT,
  "colour" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdById" TEXT NOT NULL,
  "removedAt" TIMESTAMP(3),
  "removedById" TEXT,
  "removedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vehicles_plate_valid" CHECK ("plate" ~ '^[A-Z0-9]{4,12}$')
);

CREATE TABLE IF NOT EXISTS "parking_slots" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "area" TEXT,
  "slotFor" "SlotFor" NOT NULL DEFAULT 'ANY',
  "visitor" BOOLEAN NOT NULL DEFAULT false,
  "flatId" TEXT,
  "vehicleId" TEXT,
  "allocatedAt" TIMESTAMP(3),
  "allocatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "parking_slots_pkey" PRIMARY KEY ("id"),
  -- A visitor slot belongs to no flat and holds no vehicle. ("A slot holds a vehicle only if it is
  -- allocated" is enforced by the service, not here: a CHECK would fight the SET NULL actions when
  -- a flat or vehicle is removed.)
  CONSTRAINT "parking_slots_visitor_unallocated" CHECK (NOT "visitor" OR ("flatId" IS NULL AND "vehicleId" IS NULL))
);

CREATE INDEX IF NOT EXISTS "vehicles_societyId_flatId_active_idx" ON "vehicles"("societyId", "flatId", "active");
CREATE INDEX IF NOT EXISTS "vehicles_societyId_plate_idx" ON "vehicles"("societyId", "plate");
CREATE UNIQUE INDEX IF NOT EXISTS "parking_slots_societyId_code_key" ON "parking_slots"("societyId", "code");
CREATE INDEX IF NOT EXISTS "parking_slots_societyId_flatId_idx" ON "parking_slots"("societyId", "flatId");

-- A plate is live on one flat at a time. Prisma cannot express a partial unique index, so it lives
-- only here; the service treats its violation as "already registered". A removed vehicle frees it.
CREATE UNIQUE INDEX IF NOT EXISTS "vehicles_one_live_plate_per_society"
  ON "vehicles"("societyId", "plate") WHERE "active";

DO $$ BEGIN
  ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "parking_slots" ADD CONSTRAINT "parking_slots_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "parking_slots" ADD CONSTRAINT "parking_slots_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "parking_slots" ADD CONSTRAINT "parking_slots_vehicleId_fkey"
    FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
