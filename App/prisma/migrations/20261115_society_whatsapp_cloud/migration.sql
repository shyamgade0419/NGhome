-- A society can send WhatsApp through Meta's official Cloud API with its own business account instead of a linked number.
-- Idempotent and additive.
ALTER TABLE "societies" ADD COLUMN IF NOT EXISTS "whatsappProvider" TEXT NOT NULL DEFAULT 'OPENWA';
ALTER TABLE "whatsapp_messages" ADD COLUMN IF NOT EXISTS "params" JSONB;

CREATE TABLE IF NOT EXISTS "society_whatsapp_cloud" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "wabaId" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "displayPhone" TEXT,
    "verifiedName" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "society_whatsapp_cloud_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "society_whatsapp_cloud_societyId_key" ON "society_whatsapp_cloud"("societyId");
