// Operational limits for enrichment runs, read from the environment at call time (so Railway changes
// and tests don't need a module reload). Every value is clamped; an unset or non-numeric value falls
// back to the default.

export const DEFAULT_MAX_PER_RUN = 50;
export const MAX_PER_RUN_CEILING = 1000;   // hard ceiling for ENRICHMENT_MAX_PER_RUN and for ?limit=

const toInt = (v) => {
    if (v === undefined || v === null || String(v).trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.floor(n) : null;
};
export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** ENRICHMENT_MAX_PER_RUN: how many places one run may process. Default 50, clamped to 1-1000. */
export function maxPerRun(env = process.env) {
    const n = toInt(env.ENRICHMENT_MAX_PER_RUN);
    return n === null ? DEFAULT_MAX_PER_RUN : clamp(n, 1, MAX_PER_RUN_CEILING);
}

/**
 * The size cap for one run: an explicit limit (a manual batch via ?limit=N) clamped to 1-1000, else
 * ENRICHMENT_MAX_PER_RUN. No run is unbounded, forced runs included.
 */
export function resolveLimit(limit, env = process.env) {
    const n = toInt(limit);
    return n === null ? maxPerRun(env) : clamp(n, 1, MAX_PER_RUN_CEILING);
}
