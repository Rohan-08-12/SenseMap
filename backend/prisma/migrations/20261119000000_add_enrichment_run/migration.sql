-- CreateTable
CREATE TABLE "EnrichmentRun" (
    "id" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "force" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "planned" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "errorMessage" TEXT,

    CONSTRAINT "EnrichmentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnrichmentRun_status_finishedAt_idx" ON "EnrichmentRun"("status", "finishedAt");

-- CreateIndex
CREATE INDEX "EnrichmentRun_startedAt_idx" ON "EnrichmentRun"("startedAt");

-- Overlap lock for enrichment runs. A UNIQUE index over "status" restricted (WHERE) to
-- 'running' rows means at most ONE row can be 'running' at a time: a second INSERT with
-- status='running' fails with a unique violation (Prisma error P2002), which acquireRun()
-- treats as "another run is in progress". Rows with any other status (success, failed,
-- abandoned) are outside the index, so history is unlimited.
-- Prisma's schema language cannot express partial unique indexes, so this index exists ONLY
-- in this migration (not in schema.prisma). Don't drop it, and note that `prisma migrate dev`
-- may flag it as drift — keep it by editing generated migrations rather than accepting a drop.
CREATE UNIQUE INDEX "EnrichmentRun_one_running" ON "EnrichmentRun"("status") WHERE "status" = 'running';
