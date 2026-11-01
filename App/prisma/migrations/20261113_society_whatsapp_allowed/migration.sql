-- Whether a society may send WhatsApp messages through the platform's WhatsApp number. Set only by the platform owner.
-- Off for every existing and new society until switched on. Idempotent and additive.
ALTER TABLE "societies" ADD COLUMN IF NOT EXISTS "whatsappAllowed" BOOLEAN NOT NULL DEFAULT false;
