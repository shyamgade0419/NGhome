-- Visitor and gate management: a security-guard role, resident invitations
-- (time-limited codes, stored only as a hash) and the visit log.
-- Idempotent, matching the repo's hand-written migrations. Purely additive:
-- no existing row, column or constraint is changed.

-- The new role is not used by this migration, so it is safe to add here.
ALTER TYPE "SystemRole" ADD VALUE IF NOT EXISTS 'SECURITY_GUARD';

DO $$ BEGIN
  CREATE TYPE "VisitorType" AS ENUM ('GUEST', 'CAB', 'DELIVERY', 'SERVICE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "VisitorEntryStatus" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CHECKED_IN', 'CHECKED_OUT', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "VisitorInvitationStatus" AS ENUM ('ACTIVE', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "visitor_invitations" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "flatId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "visitorName" TEXT NOT NULL,
  "visitorPhone" TEXT,
  "visitorType" "VisitorType" NOT NULL DEFAULT 'GUEST',
  "note" TEXT,
  "validFrom" TIMESTAMP(3) NOT NULL,
  "validUntil" TIMESTAMP(3) NOT NULL,
  "maxUses" INTEGER NOT NULL DEFAULT 1,
  "usedCount" INTEGER NOT NULL DEFAULT 0,
  "codeHash" TEXT NOT NULL,
  "status" "VisitorInvitationStatus" NOT NULL DEFAULT 'ACTIVE',
  "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visitor_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "visitor_invitations_window_valid" CHECK ("validUntil" > "validFrom"),
  CONSTRAINT "visitor_invitations_uses_valid" CHECK ("maxUses" >= 1 AND "usedCount" >= 0)
);

CREATE TABLE IF NOT EXISTS "visitor_entries" (
  "id" TEXT NOT NULL,
  "societyId" TEXT NOT NULL,
  "flatId" TEXT NOT NULL,
  "invitationId" TEXT,
  "visitorName" TEXT NOT NULL,
  "visitorPhone" TEXT,
  "visitorType" "VisitorType" NOT NULL DEFAULT 'GUEST',
  "vehicleNumber" TEXT,
  "purpose" TEXT,
  "status" "VisitorEntryStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "registeredById" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decidedById" TEXT,
  "decisionNote" TEXT,
  "decisionMethod" TEXT,
  "checkedInAt" TIMESTAMP(3),
  "checkedInById" TEXT,
  "checkedOutAt" TIMESTAMP(3),
  "checkedOutById" TEXT,
  "clientRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "visitor_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "visitor_invitations_codeHash_key" ON "visitor_invitations"("codeHash");
CREATE INDEX IF NOT EXISTS "visitor_invitations_societyId_flatId_status_idx" ON "visitor_invitations"("societyId", "flatId", "status");
CREATE INDEX IF NOT EXISTS "visitor_invitations_createdById_idx" ON "visitor_invitations"("createdById");
CREATE INDEX IF NOT EXISTS "visitor_entries_societyId_requestedAt_idx" ON "visitor_entries"("societyId", "requestedAt");
CREATE INDEX IF NOT EXISTS "visitor_entries_flatId_requestedAt_idx" ON "visitor_entries"("flatId", "requestedAt");
CREATE INDEX IF NOT EXISTS "visitor_entries_societyId_status_idx" ON "visitor_entries"("societyId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "visitor_entries_societyId_clientRequestId_key" ON "visitor_entries"("societyId", "clientRequestId");

DO $$ BEGIN
  ALTER TABLE "visitor_invitations" ADD CONSTRAINT "visitor_invitations_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "visitor_invitations" ADD CONSTRAINT "visitor_invitations_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "visitor_entries" ADD CONSTRAINT "visitor_entries_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "visitor_entries" ADD CONSTRAINT "visitor_entries_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "visitor_entries" ADD CONSTRAINT "visitor_entries_invitationId_fkey"
    FOREIGN KEY ("invitationId") REFERENCES "visitor_invitations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
