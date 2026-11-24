-- Additive: one new table, nothing existing is touched.
-- Holds "when did we last send alert <key>" so the 24h dedupe of the enrichment stale
-- email survives restarts and deploys. One row per alert key (currently "enrichment-stale").
-- Rollback: DROP TABLE "AlertState";  (the code falls back to in-memory dedupe if the table is missing)

-- CreateTable
CREATE TABLE "AlertState" (
    "key" TEXT NOT NULL,
    "lastSentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertState_pkey" PRIMARY KEY ("key")
);
