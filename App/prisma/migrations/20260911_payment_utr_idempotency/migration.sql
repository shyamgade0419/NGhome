-- Payment idempotency: the same flat submitting the same UTR twice (a
-- network retry after tapping Submit twice) must not create a second
-- PaymentSubmission row. A UTR is a real bank-assigned reference for one
-- specific transaction, so two rows sharing (flatId, utrNumber) can only
-- ever be the same payment. NULL utrNumber (cash/cheque payments) is never
-- considered equal to another NULL by Postgres, so this constraint never
-- blocks those — only genuine same-flat/same-UTR duplicates.
--
-- Idempotent, matching the other hand-written migrations in this directory.
CREATE UNIQUE INDEX IF NOT EXISTS "payment_submissions_flatId_utrNumber_key"
  ON "payment_submissions"("flatId", "utrNumber");
