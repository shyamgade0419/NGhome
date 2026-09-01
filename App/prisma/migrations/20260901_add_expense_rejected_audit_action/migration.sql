-- AlterEnum
-- The AuditAction enum had PAYMENT_APPROVED/PAYMENT_REJECTED but only
-- EXPENSE_APPROVED, so rejecting an expense had no action to log against.
ALTER TYPE "AuditAction" ADD VALUE 'EXPENSE_REJECTED';
