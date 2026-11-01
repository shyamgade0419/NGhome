-- The WhatsApp gateway connection, managed from the platform console. Idempotent and additive.
CREATE TABLE IF NOT EXISTS "platform_whatsapp_settings" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "url" TEXT NOT NULL,
  "apiKeyEnc" TEXT NOT NULL,
  "sessionId" TEXT,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_whatsapp_settings_pkey" PRIMARY KEY ("id")
);
