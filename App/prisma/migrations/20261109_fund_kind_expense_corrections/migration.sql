-- Funds get a kind (the corpus, or any other fund) so the totals can be shown apart and reconciled with the
-- bank. An expense can be paid out of a fund, and a posted expense can be corrected with a comment.
-- Idempotent and additive.
DO $$ BEGIN
  CREATE TYPE "FundKind" AS ENUM ('CORPUS', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "funds" ADD COLUMN IF NOT EXISTS "kind" "FundKind" NOT NULL DEFAULT 'OTHER';

-- Funds already named for the corpus are the corpus. Only runs while every fund is still the default,
-- so a re-run never overrides a kind an admin has since chosen.
UPDATE "funds" SET "kind" = 'CORPUS'
 WHERE "kind" = 'OTHER' AND "name" ILIKE '%corpus%'
   AND NOT EXISTS (SELECT 1 FROM "funds" f2 WHERE f2."societyId" = "funds"."societyId" AND f2."kind" = 'CORPUS');

ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "fundId" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "correctedAt" TIMESTAMP(3);
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "correctionNote" TEXT;

CREATE INDEX IF NOT EXISTS "expenses_fundId_idx" ON "expenses"("fundId");

DO $$ BEGIN
  ALTER TABLE "expenses" ADD CONSTRAINT "expenses_fundId_fkey"
    FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
