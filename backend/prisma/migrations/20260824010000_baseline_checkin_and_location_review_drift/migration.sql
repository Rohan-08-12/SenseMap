-- Baseline migration: reconciles migration history with schema drift that existed in the
-- database before it was tracked here — the CheckIn table and several Location/Review
-- columns were added directly to the database at some point without a matching migration
-- file. Every statement is idempotent (IF NOT EXISTS / DO-block guarded), so this is safe
-- to run against the already-drifted database as well as a fresh one.

-- Location: googlePlaceId, embedding
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "googlePlaceId" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "embedding" DOUBLE PRECISION[];

CREATE UNIQUE INDEX IF NOT EXISTS "Location_googlePlaceId_key" ON "Location"("googlePlaceId");
CREATE INDEX IF NOT EXISTS "Location_category_idx" ON "Location"("category");

-- Review: visitTime + indexes
ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "visitTime" TEXT;

CREATE INDEX IF NOT EXISTS "Review_locationId_idx" ON "Review"("locationId");
CREATE INDEX IF NOT EXISTS "Review_userId_idx" ON "Review"("userId");

-- CheckIn table
CREATE TABLE IF NOT EXISTS "CheckIn" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckIn_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CheckIn_userId_idx" ON "CheckIn"("userId");
CREATE INDEX IF NOT EXISTS "CheckIn_locationId_idx" ON "CheckIn"("locationId");

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CheckIn_userId_fkey'
    ) THEN
        ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_userId_fkey"
            FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CheckIn_locationId_fkey'
    ) THEN
        ALTER TABLE "CheckIn" ADD CONSTRAINT "CheckIn_locationId_fkey"
            FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
    END IF;
END $$;
