-- AlterTable: add audio caching fields to Location
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "audioUrl" TEXT;
ALTER TABLE "Location" ADD COLUMN IF NOT EXISTS "audioGeneratedAt" TIMESTAMP(3);
