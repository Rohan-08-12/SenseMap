import { getDisplayScore } from "./scores.js";

const MISSING_FACTOR_DEFAULT = 3;

/**
 * One factor's fit, 0-100. Tolerance is the most a user can comfortably handle, so only the
 * amount a place EXCEEDS it costs points; a place quieter/dimmer/emptier than the tolerance
 * is a full match. (Previously |score - tolerance| penalised calmer-than-needed places too.)
 */
export const factorMatch = (score, tolerance) =>
    Math.max(0, 100 - Math.max(0, score - tolerance) * 25);

/**
 * Match % for one location (Prisma row with `sensoryScores` included) against a user's
 * tolerances. Scores come from getDisplayScore so this agrees with the place panel
 * (community >= 5 reviews, 70/30 community/estimate blend for 1-4, else the AI estimate).
 * Returns null when the place has no usable score at all.
 */
export function computeMatch(loc, { noiseTolerance = 3, lightingTolerance = 3, crowdTolerance = 3 } = {}) {
    const s = loc.sensoryScores;
    const display = getDisplayScore({
        reviewCount:            s?.reviewCount ?? 0,
        noiseScore:             s?.noiseScore ?? null,
        lightingScore:          s?.lightingScore ?? null,
        crowdScore:             s?.crowdScore ?? null,
        comfortScore:           s?.comfortScore ?? null,
        estimatedNoiseScore:    loc.estimatedNoiseScore,
        estimatedLightingScore: loc.estimatedLightingScore,
        estimatedCrowdScore:    loc.estimatedCrowdScore,
    });

    // getDisplayScore can yield null/NaN for a factor a reviewer left blank; fall back per factor.
    const pick = (v, est) => (Number.isFinite(v) && v > 0 ? v : (est > 0 ? est : null));
    const noise    = pick(display.noise,    loc.estimatedNoiseScore);
    const lighting = pick(display.lighting, loc.estimatedLightingScore);
    const crowd    = pick(display.crowd,    loc.estimatedCrowdScore);
    if (noise == null && lighting == null && crowd == null) return null;

    const f = (v) => v ?? MISSING_FACTOR_DEFAULT;
    const matchScore = Math.round(
        (factorMatch(f(noise), noiseTolerance) + factorMatch(f(lighting), lightingTolerance) + factorMatch(f(crowd), crowdTolerance)) / 3,
    );
    return { matchScore, noise, lighting, crowd, comfort: display.comfort ?? null, source: display.source };
}

const SOURCE_RANK = { community: 0, estimated: 1, category: 2 };
const load = (m) => ((m.noiseScore ?? 3) + (m.lightingScore ?? 3) + (m.crowdScore ?? 3)) / 3;

/**
 * Sort comparator for match results. Because a place at or under every tolerance scores 100%,
 * ties are common, so break them: real community data first, then the calmer overall load.
 */
export function compareMatches(a, b) {
    return (b.matchScore - a.matchScore)
        || ((SOURCE_RANK[a.source] ?? 3) - (SOURCE_RANK[b.source] ?? 3))
        || (load(a) - load(b));
}
