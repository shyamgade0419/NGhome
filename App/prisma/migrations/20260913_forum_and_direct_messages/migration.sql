-- Community forum (any resident can start a topic; admin/committee-only
-- moderation for isPinned/isLocked is enforced in ForumService, not here)
-- and resident-to-resident direct messaging (refresh/poll-based, not a
-- live socket). All five tables below are brand new — purely additive,
-- nothing existing is altered. Idempotent, matching the other
-- hand-written migrations in this directory.

-- CreateTable (safe — skips if already exists)
CREATE TABLE IF NOT EXISTS "forum_topics" (
    "id"          TEXT NOT NULL,
    "societyId"   TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title"       TEXT NOT NULL,
    "body"        TEXT NOT NULL,
    "isPinned"    BOOLEAN NOT NULL DEFAULT false,
    "isLocked"    BOOLEAN NOT NULL DEFAULT false,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forum_topics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "forum_replies" (
    "id"        TEXT NOT NULL,
    "topicId"   TEXT NOT NULL,
    "authorId"  TEXT NOT NULL,
    "body"      TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_replies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "conversations" (
    "id"        TEXT NOT NULL,
    "societyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "conversation_participants" (
    "id"             TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId"         TEXT NOT NULL,
    "lastReadAt"     TIMESTAMP(3),
    "joinedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "direct_messages" (
    "id"             TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId"       TEXT NOT NULL,
    "body"           TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (safe)
CREATE INDEX IF NOT EXISTS "forum_topics_societyId_idx" ON "forum_topics"("societyId");
CREATE INDEX IF NOT EXISTS "forum_topics_societyId_isPinned_createdAt_idx" ON "forum_topics"("societyId", "isPinned", "createdAt");
CREATE INDEX IF NOT EXISTS "forum_replies_topicId_createdAt_idx" ON "forum_replies"("topicId", "createdAt");
CREATE INDEX IF NOT EXISTS "conversations_societyId_idx" ON "conversations"("societyId");
CREATE UNIQUE INDEX IF NOT EXISTS "conversation_participants_conversationId_userId_key" ON "conversation_participants"("conversationId", "userId");
CREATE INDEX IF NOT EXISTS "conversation_participants_userId_idx" ON "conversation_participants"("userId");
CREATE INDEX IF NOT EXISTS "direct_messages_conversationId_createdAt_idx" ON "direct_messages"("conversationId", "createdAt");

-- AddForeignKey (safe — skips if constraint already exists)
DO $$ BEGIN
  ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "forum_topics" ADD CONSTRAINT "forum_topics_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "forum_replies" ADD CONSTRAINT "forum_replies_topicId_fkey"
    FOREIGN KEY ("topicId") REFERENCES "forum_topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "forum_replies" ADD CONSTRAINT "forum_replies_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "conversations" ADD CONSTRAINT "conversations_societyId_fkey"
    FOREIGN KEY ("societyId") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_senderId_fkey"
    FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
