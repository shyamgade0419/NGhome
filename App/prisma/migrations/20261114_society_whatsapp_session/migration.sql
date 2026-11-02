-- Each society links its own WhatsApp number: its own session on the gateway. Idempotent and additive.
ALTER TABLE "societies" ADD COLUMN IF NOT EXISTS "whatsappSessionId" TEXT;
