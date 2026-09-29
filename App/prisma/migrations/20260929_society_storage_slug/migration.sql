-- Readable storage folder names: the society's storage folder becomes
-- {slugified-name}-{short-id} instead of its raw UUID, generated lazily on
-- first upload after this deploys (StoragePathService.resolveSegment) and
-- persisted here permanently. Files already on disk keep working under
-- their old, unchanged {societyId}/... paths.

ALTER TABLE "societies" ADD COLUMN IF NOT EXISTS "storageSlug" TEXT;

DO $$ BEGIN
  CREATE UNIQUE INDEX "societies_storageSlug_key" ON "societies"("storageSlug");
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
