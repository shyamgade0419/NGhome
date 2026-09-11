-- Two administrative actions had no audit trail at all: deleting a document
-- (irreversible — the file and its record both go) and changing a helpdesk
-- request's status. Both are explicitly the kind of action this table
-- exists to record, alongside the payment/expense/user actions it already
-- covers.
--
-- Idempotent, matching the other hand-written migrations in this directory.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DOCUMENT_DELETED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'COMPLAINT_STATUS_CHANGED';
