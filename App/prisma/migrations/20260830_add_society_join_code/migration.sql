-- Migration: add_society_join_code
-- Adds joinCode + joinCodeGeneratedAt to the societies table.
-- Existing societies start with NULL; the admin can view/generate their code
-- via GET /societies/my/join-code (auto-generates on first access) or
-- PATCH /societies/my/regenerate-join-code.

ALTER TABLE "societies"
  ADD COLUMN "joinCode"              TEXT,
  ADD COLUMN "joinCodeGeneratedAt"   TIMESTAMP(3);

-- Unique constraint — each code must be globally unique
CREATE UNIQUE INDEX "societies_joinCode_key" ON "societies"("joinCode");
