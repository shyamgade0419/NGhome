-- A flat whose water meter counts down (the numbers run backwards). Its consumption is the
-- earlier reading minus the later one. Purely additive; every existing flat reads forward.
ALTER TABLE "flats" ADD COLUMN IF NOT EXISTS "waterMeterReversed" BOOLEAN NOT NULL DEFAULT false;
