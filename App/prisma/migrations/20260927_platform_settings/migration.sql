-- Platform-wide settings (pricing mode + optional support/UPI details).
-- One row, id "singleton"; created lazily by the API, so no seed row is needed.

CREATE TABLE IF NOT EXISTS "platform_settings" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "pricingMode" TEXT NOT NULL DEFAULT 'FREE',
  "supportEnabled" BOOLEAN NOT NULL DEFAULT false,
  "supportUpiId" TEXT,
  "supportPayeeName" TEXT,
  "supportMessage" TEXT,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);
