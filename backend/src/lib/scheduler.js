import cron from "node-cron";
import { startEnrichmentCron } from "./enrichmentCron.js";
import { sendWeeklyDigest } from "../jobs/sendWeeklyDigest.js";
import { getFreshness } from "./enrichmentRuns.js";
import { runEnrichment } from "./enrichmentCron.js";
import { notifyEnrichmentStale } from "./notify.js";

const ALERT_REPEAT_MS = 24 * 60 * 60 * 1000; // re-send at most once a day while still stale
let lastAlertAt = 0;

export async function checkEnrichmentFreshness() {
    const report = await getFreshness();
    // No runs recorded at all = freshly deployed, table empty; the first cron run will populate it.
    if (report.healthy || !report.lastRun) return;
    if (Date.now() - lastAlertAt < ALERT_REPEAT_MS) return;
    lastAlertAt = Date.now();
    console.error(`[Enrichment] STALE — no place updated in ${report.hoursSinceLastUpdate ?? "never"}h (last successful run ${report.hoursSinceLastSuccess ?? "never"}h ago)`);
    await notifyEnrichmentStale(report);
}

const CATCHUP_AFTER_HOURS = 26;      // missed the 4am run (e.g. redeploy at 4am) => run on boot
const CATCHUP_DELAY_MS = 2 * 60 * 1000; // let the server settle / avoid racing a deploy overlap
const CATCHUP_MIN_GAP_MS = 60 * 60 * 1000; // don't retry more than hourly if runs keep failing

// Only on Railway (or when explicitly enabled) so a local `npm run dev` pointed at the real DB
// never kicks off paid enrichment on every nodemon restart. ENRICHMENT_CATCHUP=false disables it.
function catchupEnabled() {
    if (process.env.ENRICHMENT_CATCHUP === "false") return false;
    return process.env.ENRICHMENT_CATCHUP === "true" || !!process.env.RAILWAY_ENVIRONMENT;
}

export async function catchUpEnrichment() {
    const report = await getFreshness();
    if (report.currentlyRunning) return;
    const stale = report.hoursSinceLastSuccess === null || report.hoursSinceLastSuccess > CATCHUP_AFTER_HOURS;
    if (!stale) return;
    if (report.lastRun && Date.now() - new Date(report.lastRun.startedAt).getTime() < CATCHUP_MIN_GAP_MS) return;
    console.log(`[Enrichment] Catch-up — last success ${report.hoursSinceLastSuccess ?? "never"}h ago, starting a run`);
    // runEnrichment takes the DB lock itself, so losing a race with the cron is harmless.
    await runEnrichment({ trigger: "catchup" });
}

/**
 * Central cron registration. All scheduled background jobs are wired up here
 * and started once at boot via startScheduler() (see server.js).
 */
export function startScheduler() {
    startEnrichmentCron();

    if (catchupEnabled()) {
        setTimeout(() => {
            catchUpEnrichment().catch((err) => console.error("[Enrichment] Catch-up error:", err.message));
        }, CATCHUP_DELAY_MS);
    }

    // Hourly freshness watchdog — emails if no successful enrichment run in 36h
    cron.schedule("15 * * * *", () => {
        checkEnrichmentFreshness().catch((err) => console.error("[Enrichment] Freshness check error:", err.message));
    }, { timezone: "America/Toronto" });

    // Weekly digest — every Sunday at 9am Toronto time
    cron.schedule("0 9 * * 0", () => {
        console.log("[Digest] Cron triggered");
        sendWeeklyDigest().catch((err) => console.error("[Digest] Cron error:", err.message));
    }, { timezone: "America/Toronto" });

    console.log("[Digest] Cron scheduled — weekly, Sunday 9am Toronto");
}
