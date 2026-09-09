-- Two resident-visibility switches did not do what their labels promised.
--
-- "showCorpusToResidents" ("Residents can see the corpus fund amount") was
-- read by nothing at all. An admin switching it off believed corpus was
-- hidden while residents could still see it, because fund visibility comes
-- from each fund's own isVisibleToResidents. There is no corpus entity for a
-- global flag to refer to — a corpus is just a Fund named "Corpus" — so the
-- per-fund switch is kept as the single control and this one is dropped.
--
-- "showFundBalancesToResidents" gates the total BANK balance, not fund
-- balances, so it is renamed to say so. RENAME preserves each society's
-- existing setting; adding a new column would silently reset every society
-- to the default and could expose balances an admin had switched off.

-- Rename first, so the value survives (safe to re-run: skipped if already done)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'society_configurations'
      AND column_name = 'showFundBalancesToResidents'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'society_configurations'
      AND column_name = 'showAccountBalancesToResidents'
  ) THEN
    ALTER TABLE "society_configurations"
      RENAME COLUMN "showFundBalancesToResidents" TO "showAccountBalancesToResidents";
  END IF;
END $$;

-- Cover a fresh database where the rename source never existed
ALTER TABLE "society_configurations"
  ADD COLUMN IF NOT EXISTS "showAccountBalancesToResidents" BOOLEAN NOT NULL DEFAULT false;

-- Drop the flag that never did anything
ALTER TABLE "society_configurations"
  DROP COLUMN IF EXISTS "showCorpusToResidents";
