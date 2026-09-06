-- AlterTable (safe — skips if the columns already exist)
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "linkedEntityType" TEXT;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "linkedEntityId" TEXT;

-- CreateIndex (safe)
CREATE INDEX IF NOT EXISTS "expenses_linkedEntityType_linkedEntityId_idx"
  ON "expenses"("linkedEntityType", "linkedEntityId");
