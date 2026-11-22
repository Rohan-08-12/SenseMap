/**
 * LOCAL-ONLY DRY RUN of the enrichment analysis. Never writes to any database.
 *
 * It sends the same request the nightly cron / POST /enrichment/location send to Gemini (same model,
 * prompt, schema), runs the result through the same validator and confidence gate, and prints what
 * WOULD have happened. With --insights it also sends the /ai/insights request (Gemini only; the Claude
 * cross-check is skipped) so you can compare the two texts side by side.
 *
 * USAGE (from backend/, using GEMINI_API_KEY from your local .env; the key is never printed):
 *   node scripts/dry_run_enrichment.js                      # plan only: shows what it WOULD call, calls nothing
 *   node scripts/dry_run_enrichment.js --go                 # run the 8 built-in sample texts
 *   node scripts/dry_run_enrichment.js --go --insights      # ...and the insights call for each
 *   node scripts/dry_run_enrichment.js --go --file my.json  # [{ "name": "...", "category": "...", "text": "..." }, ...]
 *   node scripts/dry_run_enrichment.js --go --ids id1,id2   # places from a LOCAL database (see below)
 *   --max N   cap on places (default 8, hard limit 10)
 *
 * COST (Gemini 2.5 Flash, text only): one analysis call per place, plus one more per place with
 * --insights. Default run = 8 calls; with --insights = 16; 10 places with --insights = 20. A few hundred
 * input tokens each, so this is a fraction of a cent in total. --ids additionally makes ~2 Google
 * Places requests per place (text search + details) to build the input text, using GOOGLE_PLACES_KEY.
 *
 * --ids is READ-ONLY (a single findMany) and refuses to run unless DATABASE_URL points at
 * localhost / 127.0.0.1, so it can't be aimed at production by accident.
 */
import "dotenv/config";
import fs from "node:fs";
import { model } from "../src/lib/gemini.js";
import { requestAnalysis, interpretAnalysis, MIN_ENRICHMENT_CONFIDENCE } from "../src/lib/enrichmentAnalysis.js";
import { insightsSchema, buildInsightsPrompt } from "../src/lib/insightsPrompt.js";
import { applyInsightConfidence, MIN_INSIGHT_CONFIDENCE } from "../src/lib/insightConfidence.js";
import { redact, summarizeAnalyses, histogram } from "../src/lib/dryRunStats.js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

const GO = flag("--go");
const WITH_INSIGHTS = flag("--insights");
const HARD_CAP = 10;
const MAX = Math.min(HARD_CAP, Math.max(1, Number(opt("--max")) || 8));
const DELAY_MS = 1500;
const CALL_TIMEOUT_MS = 60_000;

// Anything that must never reach the console.
const SECRETS = [process.env.GEMINI_API_KEY, process.env.GOOGLE_PLACES_KEY, process.env.ANTHROPIC_API_KEY, process.env.DATABASE_URL];
const safe = (s) => redact(s, SECRETS);
const out = (...a) => console.log(...a.map((x) => (typeof x === "string" ? safe(x) : x)));

// What the real sources typically produce. Google review text is NOT fed to the model (Google's
// terms), so for many places the input is only a rating line and, sometimes, a one-line summary.
const SAMPLES = [
    { name: "YSM Evergreen Centre", category: "community_centre", text: "Google rating: 4.4/5 based on 120 reviews." },
    { name: "Annette Street Library", category: "library", text: "Annette Street is a Toronto Public Library branch. Size: 14000 sq ft. Google rating: 4.6/5 based on 310 reviews. Quiet neighbourhood library with study carrels and a children's area." },
    { name: "Harbourfront Food Hall", category: "food_hall", text: "Google rating: 4.2/5 based on 2100 reviews. Bustling food hall with live music, open kitchens and long weekend lines." },
    { name: "Trinity Bellwoods Park", category: "park", text: "Google rating: 4.7/5 based on 9800 reviews. Large park with tree-lined paths and natural light; busy with picnics on summer weekends, quiet on weekday mornings." },
    { name: "Loud Espresso Co.", category: "cafe", text: "Google rating: 4.1/5 based on 430 reviews. Small cafe with a loud espresso machine, bright fluorescent lighting and a packed lunch rush." },
    { name: "Corner Dentist", category: "dentist", text: "Google rating: 3.9/5 based on 12 reviews." },
    { name: "ROM Museum Annex", category: "museum", text: "Google rating: 4.5/5 based on 5400 reviews. Large museum with echoing galleries, school groups on weekdays and dim exhibit lighting." },
    { name: "The Rooftop Bar", category: "bar", text: "Google rating: 4.0/5 based on 880 reviews. Late-night bar with a live DJ, low lighting and standing-room crowds on weekends." },
];

function withTimeout(promise, ms) {
    let t;
    return Promise.race([promise, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms); })]).finally(() => clearTimeout(t));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (v) => (v === null ? "null" : v === undefined ? "MISSING" : typeof v === "number" ? String(v) : JSON.stringify(v));

async function loadPlaces() {
    const ids = opt("--ids");
    const file = opt("--file");
    if (ids) {
        let host = "";
        try { host = new URL(process.env.DATABASE_URL).hostname; } catch { /* handled below */ }
        if (!["localhost", "127.0.0.1"].includes(host)) {
            console.error("Refusing --ids: DATABASE_URL must point at localhost/127.0.0.1 (this script is local-only).");
            process.exit(1);
        }
        const { default: prisma } = await import("../src/lib/prisma.js");
        const { fetchAllSources } = await import("../src/services/scraper.js");
        const rows = await prisma.location.findMany({   // the only database access: one read
            where: { id: { in: ids.split(",").map((s) => s.trim()).filter(Boolean) } },
            select: { id: true, name: true, category: true, latitude: true, longitude: true, googlePlaceId: true },
        });
        await prisma.$disconnect();
        const places = [];
        for (const r of rows.slice(0, MAX)) {
            const src = await fetchAllSources({ name: r.name, latitude: r.latitude, longitude: r.longitude, category: r.category, googlePlaceId: r.googlePlaceId });
            places.push({ name: r.name, category: r.category, text: src.combinedText || "" });
        }
        return places;
    }
    if (file) return JSON.parse(fs.readFileSync(file, "utf8")).slice(0, MAX);
    return SAMPLES.slice(0, MAX);
}

async function main() {
    if (!process.env.GEMINI_API_KEY) { console.error("GEMINI_API_KEY is not set in your local environment (.env)."); process.exit(1); }

    const planCount = opt("--ids") ? Math.min(MAX, opt("--ids").split(",").filter(Boolean).length) : opt("--file") ? null : Math.min(MAX, SAMPLES.length);
    const callsPer = WITH_INSIGHTS ? 2 : 1;
    if (!GO) {
        out(`PLAN ONLY (nothing was called). Add --go to run.`);
        out(`  inputs:  ${opt("--ids") ? "places from a local DB (read-only) + Google Places lookups" : opt("--file") ? "your JSON file" : "built-in sample texts"}`);
        out(`  gemini:  ${planCount === null ? `up to ${MAX}` : planCount} analysis call(s)${WITH_INSIGHTS ? ` + same number of insights calls = up to ${(planCount ?? MAX) * callsPer} total` : ""}`);
        out(`  writes:  none, ever`);
        return;
    }

    const places = await loadPlaces();
    out(`Dry run: ${places.length} place(s), ${places.length * callsPer} Gemini call(s)${WITH_INSIGHTS ? " (analysis + insights)" : ""}. No database writes.\n`);

    const rows = [];
    const insightConfs = [];

    for (let i = 0; i < places.length; i++) {
        const p = places[i];
        out(`[${i + 1}/${places.length}] ${p.name}  (${p.category ?? "no category"}, input ${p.text.length} chars)`);

        let analysis = null, decision = null;
        if (!p.text.trim()) {
            out("  no input text for this place (the real pipeline skips Gemini here too)\n");
            rows.push({ analysis: null, decision: null });
            continue;
        }
        try {
            analysis = await withTimeout(requestAnalysis(model, p.name, p.text), CALL_TIMEOUT_MS);
            decision = interpretAnalysis(analysis);
            out(`  raw scores   noise=${fmt(analysis.noise_score)}  lighting=${fmt(analysis.lighting_score)}  crowd=${fmt(analysis.crowd_score)}   confidence=${fmt(analysis.confidence)}`);
            out(`  validator    ${decision.action === "write" ? "ACCEPTED" : `REJECTED (${decision.reason})`}`);
            out(`  would write  ${decision.action === "write"
                ? `YES -> noise ${decision.noise}, lighting ${decision.lighting}, crowd ${decision.crowd} (0.5-5 scale), enrichmentConfidence ${decision.confidence}`
                : `NO estimates (would record enrichmentConfidence=${decision.confidence ?? "none"}${decision.reason === "invalid_scores" || decision.reason === "invalid_confidence" || decision.reason === "incomplete_scores" ? "; place would be retried soon (unless OSM tags were saved)" : "; place marked enriched"})`}`);
        } catch (err) {
            out(`  ANALYSIS CALL FAILED: ${err.message}`);
        }
        rows.push({ analysis, decision });

        if (WITH_INSIGHTS) {
            await sleep(DELAY_MS);
            try {
                const result = await withTimeout(model.generateContent({
                    contents: [{ role: "user", parts: [{ text: buildInsightsPrompt({ name: p.name, category: p.category }, p.text) }] }],
                    generationConfig: { responseMimeType: "application/json", responseSchema: insightsSchema },
                }), CALL_TIMEOUT_MS);
                const insight = JSON.parse(result.response.text());
                const shown = applyInsightConfidence(insight);
                if (Number.isFinite(insight.confidence)) insightConfs.push(insight.confidence);
                const raw = [insight.noise?.summary, insight.lighting?.summary, insight.crowd?.summary].filter(Boolean).join(" ");
                out(`  insight      confidence ${fmt(insight.confidence)}/100  -> ${shown.lowConfidence ? "HIDDEN from users (low confidence)" : "shown to users"}`);
                out(`  insight text (raw, first 200): ${raw.slice(0, 200) || "(empty)"}`);
                const gem = analysis && decision?.action === "write" ? decision : null;
                if (gem && !shown.lowConfidence) {
                    const diffs = [["noise", gem.noise, insight.noise?.score], ["lighting", gem.lighting, insight.lighting?.score], ["crowd", gem.crowd, insight.crowd?.score]]
                        .filter(([, a, b]) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 1.5)
                        .map(([n, a, b]) => `${n}: stored ${a} vs insight ${b}`);
                    if (diffs.length) out(`  DISAGREE     ${diffs.join("; ")}`);
                }
            } catch (err) {
                out(`  INSIGHTS CALL FAILED: ${err.message}`);
            }
        }
        out("");
        if (i < places.length - 1) await sleep(DELAY_MS);
    }

    const s = summarizeAnalyses(rows, MIN_ENRICHMENT_CONFIDENCE);
    const pct = (x) => `${(x * 100).toFixed(0)}%`;
    out("=== SUMMARY ===");
    out(`places: ${s.places}   analysis calls failed/skipped: ${s.failedCalls}   would be written: ${s.wouldWrite}`);
    out(`null rate   noise ${pct(s.nullRatePerFactor.noise_score)}   lighting ${pct(s.nullRatePerFactor.lighting_score)}   crowd ${pct(s.nullRatePerFactor.crowd_score)}   overall ${pct(s.overallNullRate)}`);
    out(`outcomes    ${Object.entries(s.reasons).map(([k, v]) => `${k}=${v}`).join("  ") || "(none)"}`);
    out(`confidence (0-10, gate = ${MIN_ENRICHMENT_CONFIDENCE})   n=${s.confidence.n}  missing/invalid=${s.confidence.missingOrInvalid}  mean=${s.confidence.mean?.toFixed(1) ?? "-"}  median=${s.confidence.median ?? "-"}  below gate=${s.confidence.belowThreshold}`);
    for (const [b, n] of Object.entries(s.confidence.histogram)) out(`   ${String(b).padStart(2)} | ${"#".repeat(n)} ${n || ""}`);
    if (WITH_INSIGHTS && insightConfs.length) {
        out(`insights confidence (0-100, hidden below ${MIN_INSIGHT_CONFIDENCE}):  n=${insightConfs.length}  hidden=${insightConfs.filter((c) => c < MIN_INSIGHT_CONFIDENCE).length}`);
        for (const [b, n] of Object.entries(histogram(insightConfs, 100, 10))) out(`   ${String(b).padStart(3)} | ${"#".repeat(n)} ${n || ""}`);
    }
}

main().catch((err) => { console.error("dry run failed:", safe(err?.message ?? err)); process.exit(1); });
