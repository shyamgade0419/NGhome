-- Staff attendance: the shifts a society uses, the duty roster (who works which shift on which
-- date) and what actually happened each day. Idempotent, matching the repo's hand-written
-- migrations. Purely additive: nothing existing changes (salaries are untouched).

DO $$ BEGIN
  CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "staff_shifts" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "startMinute" INTEGER NOT NULL,
  "endMinute" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_shifts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_shifts_minutes_valid" CHECK ("startMinute" BETWEEN 0 AND 1439 AND "endMinute" BETWEEN 0 AND 1439 AND "startMinute" <> "endMinute")
);

CREATE TABLE IF NOT EXISTS "staff_roster" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "shiftId" TEXT,
  "post" TEXT,
  "assignedById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_roster_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "staff_attendance" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
  "checkInAt" TIMESTAMP(3),
  "checkOutAt" TIMESTAMP(3),
  "checkedInById" TEXT,
  "checkedOutById" TEXT,
  "markedById" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_attendance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_attendance_out_after_in" CHECK ("checkOutAt" IS NULL OR ("checkInAt" IS NOT NULL AND "checkOutAt" >= "checkInAt"))
);

CREATE UNIQUE INDEX IF NOT EXISTS "staff_shifts_societyId_name_key" ON "staff_shifts"("societyId", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "staff_roster_employeeId_date_key" ON "staff_roster"("employeeId", "date");
CREATE INDEX IF NOT EXISTS "staff_roster_societyId_date_idx" ON "staff_roster"("societyId", "date");
CREATE UNIQUE INDEX IF NOT EXISTS "staff_attendance_employeeId_date_key" ON "staff_attendance"("employeeId", "date");
CREATE INDEX IF NOT EXISTS "staff_attendance_societyId_date_idx" ON "staff_attendance"("societyId", "date");

DO $$ BEGIN
  ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "staff_roster" ADD CONSTRAINT "staff_roster_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "staff_roster" ADD CONSTRAINT "staff_roster_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "society_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- NO ACTION (checked at the end of the statement), not RESTRICT: when a whole society is deleted its
-- shifts and roster rows are removed together, and RESTRICT would refuse depending on the order.
DO $$ BEGIN
  ALTER TABLE "staff_roster" ADD CONSTRAINT "staff_roster_shiftId_fkey"
    FOREIGN KEY ("shiftId") REFERENCES "staff_shifts"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "society_employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
