-- A financial Transaction should never be linked to more than one payment.
-- approve() and submit()'s auto-approve path both only ever set
-- transactionId once per payment (guarded by an atomic conditional status
-- transition — PENDING/UNDER_REVIEW -> APPROVED happens at most once per
-- row), so no existing row should violate this; this is a second,
-- database-level guarantee independent of the application logic staying
-- correct. NULL (every payment that was never approved) is never
-- considered equal to another NULL by Postgres, so this never blocks
-- PENDING/REJECTED rows.
--
-- See prisma/checks/check-payment-transaction-duplicates.sql — a read-only
-- query to confirm no duplicates exist before this applies to production.
--
-- Idempotent, matching the other hand-written migrations in this directory.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_submissions_transactionId_key"
  ON "payment_submissions"("transactionId");
