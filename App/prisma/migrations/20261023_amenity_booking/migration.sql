-- Amenity booking: shared spaces residents can book, and their bookings.
-- Idempotent, matching the repo's hand-written migrations.

DO $$ BEGIN
  CREATE TYPE "AmenityBookingMode" AS ENUM ('INSTANT', 'NEEDS_APPROVAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AmenityBookingStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "AmenityFeeStatus" AS ENUM ('NONE', 'DUE', 'COLLECTED', 'WAIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "amenities" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "rules" TEXT,
  "bookingMode" "AmenityBookingMode" NOT NULL DEFAULT 'INSTANT',
  "slotMinutes" INTEGER NOT NULL DEFAULT 60,
  "opensAtMin" INTEGER NOT NULL DEFAULT 360,
  "closesAtMin" INTEGER NOT NULL DEFAULT 1320,
  "maxAdvanceDays" INTEGER NOT NULL DEFAULT 30,
  "monthlyCapPerFlat" INTEGER,
  "cancelBeforeHours" INTEGER NOT NULL DEFAULT 24,
  "capacity" INTEGER NOT NULL DEFAULT 1,
  "maxSlotsPerBooking" INTEGER NOT NULL DEFAULT 1,
  "fee" DECIMAL(12,2),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "amenities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "amenity_bookings" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "amenityId" TEXT NOT NULL,
  "flatId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "startAt" TIMESTAMP(3) NOT NULL,
  "endAt" TIMESTAMP(3) NOT NULL,
  "status" "AmenityBookingStatus" NOT NULL,
  "guestCount" INTEGER NOT NULL DEFAULT 0,
  "note" TEXT,
  "feeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "feeStatus" "AmenityFeeStatus" NOT NULL DEFAULT 'NONE',
  "decidedById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "rejectionReason" TEXT,
  "cancelledAt" TIMESTAMP(3),
  "cancelledById" TEXT,
  "collectedAccountId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "amenity_bookings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "amenities_societyId_idx" ON "amenities"("societyId");
CREATE INDEX IF NOT EXISTS "amenity_bookings_amenityId_startAt_idx" ON "amenity_bookings"("amenityId", "startAt");
CREATE INDEX IF NOT EXISTS "amenity_bookings_societyId_status_idx" ON "amenity_bookings"("societyId", "status");
CREATE INDEX IF NOT EXISTS "amenity_bookings_flatId_idx" ON "amenity_bookings"("flatId");
CREATE INDEX IF NOT EXISTS "amenity_bookings_userId_idx" ON "amenity_bookings"("userId");

DO $$ BEGIN
  ALTER TABLE "amenities" ADD CONSTRAINT "amenities_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "amenity_bookings" ADD CONSTRAINT "amenity_bookings_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "amenity_bookings" ADD CONSTRAINT "amenity_bookings_amenityId_fkey"
    FOREIGN KEY ("amenityId") REFERENCES "amenities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "amenity_bookings" ADD CONSTRAINT "amenity_bookings_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "amenity_bookings" ADD CONSTRAINT "amenity_bookings_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Prisma does not model CHECK constraints; these are a last line of defence
-- against a bad row that slips past the service's own validation.
DO $$ BEGIN
  ALTER TABLE "amenity_bookings" ADD CONSTRAINT "amenity_bookings_end_after_start" CHECK ("endAt" > "startAt");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "amenities" ADD CONSTRAINT "amenities_hours_valid"
    CHECK ("opensAtMin" >= 0 AND "closesAtMin" <= 1440 AND "closesAtMin" > "opensAtMin" AND "slotMinutes" > 0 AND "capacity" >= 1);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
