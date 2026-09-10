-- Two-way helpdesk: replies on a maintenance request, visible to the resident
-- who raised it and to the society's staff. Idempotent, matching the other
-- hand-written migrations in this directory.

CREATE TABLE IF NOT EXISTS "maintenance_request_comments" (
  "id"        TEXT         NOT NULL,
  "requestId" TEXT         NOT NULL,
  "authorId"  TEXT         NOT NULL,
  "body"      TEXT         NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "maintenance_request_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "maintenance_request_comments_requestId_createdAt_idx"
  ON "maintenance_request_comments"("requestId", "createdAt");

-- Cascade on the request: comments have no meaning without their ticket.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_request_comments_requestId_fkey'
  ) THEN
    ALTER TABLE "maintenance_request_comments"
      ADD CONSTRAINT "maintenance_request_comments_requestId_fkey"
      FOREIGN KEY ("requestId") REFERENCES "maintenance_requests"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Restrict on the author: removing a user must not silently delete what they
-- said in someone else's ticket.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_request_comments_authorId_fkey'
  ) THEN
    ALTER TABLE "maintenance_request_comments"
      ADD CONSTRAINT "maintenance_request_comments_authorId_fkey"
      FOREIGN KEY ("authorId") REFERENCES "users"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
