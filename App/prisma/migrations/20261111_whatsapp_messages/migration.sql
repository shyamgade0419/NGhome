-- The outbox for WhatsApp automation: bill published, reminders, late fine, payment received. Idempotent and
-- additive. No foreign keys on purpose (see the model's comment in schema.prisma).
CREATE TABLE IF NOT EXISTS "whatsapp_messages" (
  "id"              TEXT NOT NULL,
  "societyId"       TEXT NOT NULL,
  "kind"            TEXT NOT NULL,
  "dedupeKey"       TEXT NOT NULL,
  "recipientUserId" TEXT,
  "toPhone"         TEXT NOT NULL,
  "body"            TEXT NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'PENDING',
  "attempts"        INTEGER NOT NULL DEFAULT 0,
  "lastError"       TEXT,
  "sendAfter"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt"          TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "whatsapp_messages_status_valid" CHECK ("status" IN ('PENDING', 'SENDING', 'SENT', 'FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_messages_societyId_dedupeKey_key" ON "whatsapp_messages"("societyId", "dedupeKey");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_status_sendAfter_idx" ON "whatsapp_messages"("status", "sendAfter");
CREATE INDEX IF NOT EXISTS "whatsapp_messages_societyId_createdAt_idx" ON "whatsapp_messages"("societyId", "createdAt");
