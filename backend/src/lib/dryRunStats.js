// Pure helpers for scripts/dry_run_enrichment.js (kept in src/ so they can be unit-tested).

/** Replace every occurrence of each secret in `text` so keys can never reach the console. */
export function redact(text, secrets) {
    let out = String(text ?? "");
    for (const s of secrets) if (s && s.length >= 6) out = out.split(s).join("***");
    return out;
}

export function median(nums) {
    if (nums.length === 0) return null;
    const s = [...nums].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Counts of integer-rounded values 0..max, e.g. confidence 0-10 -> 11 buckets. */
export function histogram(nums, max, step = 1) {
    const buckets = {};
    for (let b = 0; b <= max; b += step) buckets[b] = 0;
    for (const n of nums) {
        const b = Math.min(max, Math.floor(n / step) * step);
        buckets[b] += 1;
    }
    return buckets;
}

/**
 * rows: [{ analysis, decision }] where analysis is Gemini's parsed JSON (or null on a failed call).
 * Returns null rates per factor, overall null rate, decision-reason counts and confidence stats.
 */
export function summarizeAnalyses(rows, minConfidence) {
    const ok = rows.filter((r) => r.analysis);
    const factors = ["noise_score", "lighting_score", "crowd_score"];
    const nullCount = Object.fromEntries(factors.map((f) => [f, ok.filter((r) => r.analysis[f] === null || r.analysis[f] === undefined).length]));
    const totalNull = Object.values(nullCount).reduce((a, b) => a + b, 0);
    const reasons = {};
    for (const r of ok) {
        const key = r.decision.action === "write" ? "written" : r.decision.reason;
        reasons[key] = (reasons[key] ?? 0) + 1;
    }
    const confs = ok.map((r) => r.decision.confidence).filter((c) => c !== null && c !== undefined);
    return {
        places: rows.length, failedCalls: rows.length - ok.length,
        nullRatePerFactor: Object.fromEntries(factors.map((f) => [f, ok.length ? nullCount[f] / ok.length : 0])),
        overallNullRate: ok.length ? totalNull / (ok.length * factors.length) : 0,
        reasons,
        wouldWrite: reasons.written ?? 0,
        confidence: {
            n: confs.length, missingOrInvalid: ok.length - confs.length,
            mean: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
            median: median(confs),
            belowThreshold: confs.filter((c) => c < minConfidence).length,
            histogram: histogram(confs, 10),
        },
    };
}
