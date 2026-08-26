-- Add JWT payload context fields to refresh_tokens so token rotation
-- does not require decoding the opaque refresh token as a JWT.
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "societyId"    TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "membershipId" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "role"         TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN IF NOT EXISTS "flatId"       TEXT;
