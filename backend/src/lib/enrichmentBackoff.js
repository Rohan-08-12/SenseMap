// Long retry delay for places whose analysis came back incomplete (some scores null, some present).
// Re-asking costs a Gemini call and rarely changes the answer, so such places are left alone for 30 days
// (or the normal staleness window, if that is ever longer). The outcome is recorded as an EnrichmentLog
// row ({ outcome: "incomplete_scores", ... }) so it can be counted later and so no schema change is needed.

export const STALE_THRESHOLD_HOURS = 24 * 7;                 // normal re-enrichment window (weekly)
export const INCOMPLETE_RETRY_DAYS = 30;
export const retryHoursFor = (staleHours) => Math.max(INCOMPLETE_RETRY_DAYS * 24, staleHours);
export const INCOMPLETE_RETRY_HOURS = retryHoursFor(STALE_THRESHOLD_HOURS);

export const INCOMPLETE_OUTCOME = "incomplete_scores";

/** Record that this place's analysis was incomplete (ignored by every reader except the backoff query). */
export function logIncomplete(prisma, locationId, decision, sources = []) {
    return prisma.enrichmentLog.create({
        data: { locationId, scores: { outcome: INCOMPLETE_OUTCOME, confidence: decision.confidence ?? null, sources } },
    });
}

/** Ids of places still inside their incomplete-scores backoff window; exclude them from staleness queries. */
export async function idsInIncompleteBackoff(prisma, now = Date.now()) {
    const since = new Date(now - INCOMPLETE_RETRY_HOURS * 60 * 60 * 1000);
    const rows = await prisma.enrichmentLog.findMany({
        where: { updatedAt: { gt: since }, scores: { path: ["outcome"], equals: INCOMPLETE_OUTCOME } },
        select: { locationId: true },
    });
    return [...new Set(rows.map((r) => r.locationId))];
}

/** Prisma `where` for "stale and not in backoff". */
export function staleWhere(cutoff, backoffIds) {
    const stale = { OR: [{ lastEnrichedAt: null }, { lastEnrichedAt: { lt: cutoff } }] };
    return backoffIds.length > 0 ? { AND: [stale, { id: { notIn: backoffIds } }] } : stale;
}
