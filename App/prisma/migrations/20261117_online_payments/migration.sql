-- Online payments from the app through a society's own Razorpay account. Idempotent and additive.
DO $$ BEGIN
  CREATE TYPE "GatewayOrderStatus" AS ENUM ('CREATED', 'PAID', 'EXPIRED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "society_payment_gateway" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',
    "keyId" TEXT NOT NULL,
    "keySecretEnc" TEXT NOT NULL,
    "settlementAccountId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "society_payment_gateway_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "society_payment_gateway_societyId_key" ON "society_payment_gateway"("societyId");

CREATE TABLE IF NOT EXISTS "gateway_orders" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "maintenanceBillId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',
    "providerLinkId" TEXT,
    "providerPaymentId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "GatewayOrderStatus" NOT NULL DEFAULT 'CREATED',
    "failureReason" TEXT,
    "paymentSubmissionId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gateway_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "gateway_orders_providerLinkId_key" ON "gateway_orders"("providerLinkId");
CREATE UNIQUE INDEX IF NOT EXISTS "gateway_orders_providerPaymentId_key" ON "gateway_orders"("providerPaymentId");
CREATE UNIQUE INDEX IF NOT EXISTS "gateway_orders_paymentSubmissionId_key" ON "gateway_orders"("paymentSubmissionId");
CREATE INDEX IF NOT EXISTS "gateway_orders_societyId_status_idx" ON "gateway_orders"("societyId", "status");
CREATE INDEX IF NOT EXISTS "gateway_orders_userId_idx" ON "gateway_orders"("userId");
