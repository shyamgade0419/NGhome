-- A water reading can record how much of its charge came from a usage limit (units above the limit and what
-- they cost on top of the normal rate). Idempotent and additive.
ALTER TABLE "water_meter_readings" ADD COLUMN IF NOT EXISTS "excessUnits" DECIMAL(12,3);
ALTER TABLE "water_meter_readings" ADD COLUMN IF NOT EXISTS "excessCharge" DECIMAL(12,2);
