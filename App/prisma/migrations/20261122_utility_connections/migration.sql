-- A flat's electricity connection, for a monthly reminder to check and pay the bill. Idempotent and additive.
CREATE TABLE IF NOT EXISTS "utility_connections" (
    "id" TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "flatId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'ELECTRICITY',
    "providerCode" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "providerUrl" TEXT,
    "consumerNumber" TEXT NOT NULL,
    "nickname" TEXT,
    "reminderDay" INTEGER NOT NULL DEFAULT 8,
    "remindersOn" BOOLEAN NOT NULL DEFAULT true,
    "lastRemindedMonth" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "utility_connections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "utility_connections_flatId_kind_consumerNumber_key" ON "utility_connections"("flatId", "kind", "consumerNumber");
CREATE INDEX IF NOT EXISTS "utility_connections_societyId_flatId_idx" ON "utility_connections"("societyId", "flatId");
CREATE INDEX IF NOT EXISTS "utility_connections_remindersOn_reminderDay_idx" ON "utility_connections"("remindersOn", "reminderDay");
