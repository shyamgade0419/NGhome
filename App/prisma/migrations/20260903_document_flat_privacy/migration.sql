-- AlterEnum (safe — skips if the value already exists)
DO $$ BEGIN
  ALTER TYPE "DocumentAccessLevel" ADD VALUE 'FLAT_PRIVATE';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable (safe — skips if the column already exists)
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "flatId" TEXT;

-- CreateIndex (safe)
CREATE INDEX IF NOT EXISTS "documents_flatId_idx" ON "documents"("flatId");

-- AddForeignKey (safe — skips if the constraint already exists)
DO $$ BEGIN
  ALTER TABLE "documents" ADD CONSTRAINT "documents_flatId_fkey"
    FOREIGN KEY ("flatId") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
