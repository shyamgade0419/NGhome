-- Owner or tenant, per membership. Tenants are kept away from the corpus and bank balances.
-- Idempotent and additive: every existing member is an owner until the admin says otherwise.
DO $$ BEGIN
  CREATE TYPE "ResidencyType" AS ENUM ('OWNER', 'TENANT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "society_memberships" ADD COLUMN IF NOT EXISTS "residencyType" "ResidencyType" NOT NULL DEFAULT 'OWNER';
