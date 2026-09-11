-- Run this against production BEFORE the
-- 20260912_payment_transaction_uniqueness migration deploys. Read-only —
-- safe to run any time, changes nothing.
--
-- transactionId is only ever set by approve() or submit()'s auto-approve
-- path, each exactly once per payment (guarded by an atomic conditional
-- status transition), to a fresh UUID from a just-created Transaction row —
-- there is no code path that should ever have produced a duplicate. This
-- check exists to actually confirm that against real data rather than take
-- it on faith before a UNIQUE INDEX enforces it.

SELECT
  "transactionId",
  COUNT(*)                             AS duplicate_count,
  array_agg(id ORDER BY "approvedAt")  AS payment_ids,
  array_agg(status ORDER BY "approvedAt") AS statuses
FROM payment_submissions
WHERE "transactionId" IS NOT NULL
GROUP BY "transactionId"
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- If this returns zero rows: nothing to do, the migration applies cleanly.
--
-- If it returns rows: do NOT let the migration run as-is. Each group is two
-- or more payments claiming the same financial Transaction — investigate
-- before touching anything; this would mean either a real accounting bug
-- (one Transaction credited for two payments) or a data artifact from
-- before the atomic approval claim existed. Do not delete or reassign rows
-- without understanding which payment the money actually belongs to.
