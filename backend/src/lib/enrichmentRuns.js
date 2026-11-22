import prisma from "./prisma.js";

// A run whose heartbeat is older than this is presumed dead (process crashed or was redeployed
// mid-run) and is marked "abandoned" so it can't hold the lock forever. Heartbeats are written
// after every location (~2s apart), so 15 minutes of silence is unambiguous.
export const RUN_STALE_AFTER_MS = 15 * 60 * 1000;

// No successful run within this window => data is considered stale and an alert fires.
export const FRESHNESS_ALERT_HOURS = 36;

const MAX_RECORDED_ERRORS = 50;

/**
 * Tries to start a run. Returns the new EnrichmentRun row, or null if another run is active.
 * The lock is a partial unique index on status='running' (see migration), so it holds across
 * processes (cron, trigger endpoint, overlapping Railway deploys), not just within this one.
 */
export async function acquireRun({ trigger, force = false }) {
    await prisma.enrichmentRun.updateMany({
        where: { status: "running", heartbeatAt: { lt: new Date(Date.now() - RUN_STALE_AFTER_MS) } },
        data: { status: "abandoned", finishedAt: new Date(), errorMessage: "No heartbeat — process likely crashed or redeployed" },
    });

    try {
        return await prisma.enrichmentRun.create({ data: { trigger, force } });
    } catch (err) {
        if (err.code === "P2002") return null; // unique violation => a run is already in progress
        throw err;
    }
}

export function heartbeat(runId, counts) {
    return prisma.enrichmentRun.update({
        where: { id: runId },
        data: { heartbeatAt: new Date(), ...counts },
    });
}

// `errors` (a JSON column) was a bare array of { location, message }. It now holds
// { items, skipReasons, googleIssues } when a summary is given; readers go through normalizeRunErrors().
export function normalizeRunErrors(raw) {
    if (Array.isArray(raw)) return { items: raw, skipReasons: null, googleIssues: null };
    return { items: raw?.items ?? [], skipReasons: raw?.skipReasons ?? null, googleIssues: raw?.googleIssues ?? null };
}

export function finishRun(runId, { status, counts = {}, errors, summary, errorMessage }) {
    const items = errors?.length ? errors.slice(0, MAX_RECORDED_ERRORS) : [];
    const stored = summary ? { items, skipReasons: summary.skipReasons ?? {}, googleIssues: summary.googleIssues ?? {} } : (items.length ? items : undefined);
    return prisma.enrichmentRun.update({
        where: { id: runId },
        data: {
            status,
            finishedAt: new Date(),
            heartbeatAt: new Date(),
            ...counts,
            errors: stored,
            errorMessage: errorMessage ?? null,
        },
    });
}

/** Snapshot used by GET /enrichment/freshness and the stale-data alert. */
export async function getFreshness() {
    const now = Date.now();
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const [lastSuccess, lastRun, running, recentFailures, total, enrichedLast7d, neverEnriched, oldest, newest] =
        await Promise.all([
            prisma.enrichmentRun.findFirst({ where: { status: "success" }, orderBy: { finishedAt: "desc" } }),
            prisma.enrichmentRun.findFirst({ orderBy: { startedAt: "desc" } }),
            prisma.enrichmentRun.findFirst({ where: { status: "running" } }),
            prisma.enrichmentRun.findMany({
                where: { status: { in: ["failed", "abandoned"] }, startedAt: { gte: new Date(now - 7 * 24 * 60 * 60 * 1000) } },
                orderBy: { startedAt: "desc" },
                take: 10,
            }),
            prisma.location.count(),
            prisma.location.count({ where: { lastEnrichedAt: { gte: sevenDaysAgo } } }),
            prisma.location.count({ where: { lastEnrichedAt: null } }),
            prisma.location.findFirst({ where: { lastEnrichedAt: { not: null } }, orderBy: { lastEnrichedAt: "asc" }, select: { lastEnrichedAt: true } }),
            prisma.location.findFirst({ where: { lastEnrichedAt: { not: null } }, orderBy: { lastEnrichedAt: "desc" }, select: { lastEnrichedAt: true } }),
        ]);

    const lastSuccessAt = lastSuccess?.finishedAt ?? null;
    const hoursSinceSuccess = lastSuccessAt ? (now - lastSuccessAt.getTime()) / 3_600_000 : null;
    // Never succeeded counts as unhealthy — but a freshly deployed instance with no history
    // shouldn't page anyone instantly, so the alert caller applies its own grace (see scheduler).
    const healthy = hoursSinceSuccess !== null && hoursSinceSuccess <= FRESHNESS_ALERT_HOURS;

    const summarize = r => r && {
        id: r.id, trigger: r.trigger, force: r.force, status: r.status,
        startedAt: r.startedAt, finishedAt: r.finishedAt,
        planned: r.planned, updated: r.updated, skipped: r.skipped, failed: r.failed,
        errorMessage: r.errorMessage,
        ...(({ items, skipReasons, googleIssues }) => ({ errors: items, skipReasons, googleIssues }))(normalizeRunErrors(r.errors)),
    };

    return {
        healthy,
        alertThresholdHours: FRESHNESS_ALERT_HOURS,
        hoursSinceLastSuccess: hoursSinceSuccess === null ? null : Math.round(hoursSinceSuccess * 10) / 10,
        lastSuccessfulRun: summarize(lastSuccess),
        lastRun: summarize(lastRun),
        currentlyRunning: !!running,
        recentFailures: recentFailures.map(summarize),
        locations: {
            total,
            enrichedLast7d,
            staleOver7d: total - enrichedLast7d - neverEnriched,
            neverEnriched,
            oldestEnrichedAt: oldest?.lastEnrichedAt ?? null,
            newestEnrichedAt: newest?.lastEnrichedAt ?? null,
        },
    };
}
