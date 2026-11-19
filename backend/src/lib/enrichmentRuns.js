import prisma from "./prisma.js";

// A run whose heartbeat is older than this is presumed dead (process crashed or was redeployed
// mid-run) and is marked "abandoned" so it can't hold the lock forever. Heartbeats are written
// after every location (~2s apart), so 15 minutes of silence is unambiguous.
export const RUN_STALE_AFTER_MS = 15 * 60 * 1000;

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

export function finishRun(runId, { status, counts = {}, errors, errorMessage }) {
    return prisma.enrichmentRun.update({
        where: { id: runId },
        data: {
            status,
            finishedAt: new Date(),
            heartbeatAt: new Date(),
            ...counts,
            errors: errors?.length ? errors.slice(0, MAX_RECORDED_ERRORS) : undefined,
            errorMessage: errorMessage ?? null,
        },
    });
}
