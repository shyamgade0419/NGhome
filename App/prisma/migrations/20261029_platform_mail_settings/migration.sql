-- The outgoing-mail login, managed from the platform console. Idempotent,
-- matching the repo's hand-written migrations.

CREATE TABLE IF NOT EXISTS "platform_mail_settings" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "host" TEXT NOT NULL,
  "port" INTEGER NOT NULL,
  "username" TEXT,
  "passwordEnc" TEXT,
  "fromAddress" TEXT,
  "fromName" TEXT,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_mail_settings_pkey" PRIMARY KEY ("id")
);
