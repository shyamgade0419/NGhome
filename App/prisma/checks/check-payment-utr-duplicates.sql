-- Run this against production BEFORE the 20260911_payment_utr_idempotency
-- migration deploys. It is read-only (a plain SELECT) — safe to run any
-- time, changes nothing.
--
-- The migration creates a UNIQUE INDEX on payment_submissions(flatId,
-- utrNumber). If any flat already has two rows with the identical, non-null
-- UTR, Postgres will refuse to create the index and the migration fails —
-- loudly, not silently: `prisma migrate deploy` (the Dockerfile's boot
-- step) exits non-zero and the container never starts serving traffic, so
-- this cannot corrupt or silently drop data either way. This check just
-- lets you find out on your own schedule instead of at deploy time.

SELECT
  "flatId",
  "utrNumber",
  COUNT(*)                    AS duplicate_count,
  array_agg(id ORDER BY "createdAt")        AS payment_ids,
  array_agg(status ORDER BY "createdAt")    AS statuses,
  array_agg("createdAt" ORDER BY "createdAt") AS created_at
FROM payment_submissions
WHERE "utrNumber" IS NOT NULL
GROUP BY "flatId", "utrNumber"
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- If this returns zero rows: nothing to do, the migration will apply cleanly.
--
-- If it returns rows: each one is a flat that submitted the same UTR more
-- than once. Before the migration can apply, every group needs to be down
-- to one row per (flatId, utrNumber). Do NOT delete rows automatically —
-- review each group by hand:
--   - If one row is APPROVED (or has a transactionId) and the other(s) are
--     PENDING/REJECTED with no transaction, the PENDING/REJECTED ones are
--     almost certainly the exact duplicate-submission bug this migration
--     exists to prevent going forward — safe candidates to soft-handle
--     (e.g. mark REJECTED with a note) once you've confirmed no money or
--     downstream record depends on them.
--   - If more than one row in a group is APPROVED or has its own
--     transactionId, stop and investigate before touching anything — that
--     is not a resubmission artifact, something else is going on and
--     deleting the "wrong" one would misstate the books.
