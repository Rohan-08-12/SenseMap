import cron from "node-cron";
import { startEnrichmentCron } from "./enrichmentCron.js";
import { sendWeeklyDigest } from "../jobs/sendWeeklyDigest.js";
import prisma from "./prisma.js";
import { getFreshness, getRunActivity, RUN_STALE_AFTER_MS, formatHours } from "./enrichmentRuns.js";
import { runEnrichment } from "./enrichmentCron.js";
import { notifyEnrichmentStale } from "./notify.js";

const ALERT_REPEAT_MS = 24 * 60 * 60 * 1000; // re-send at most once a day while still stale
const ALERT_KEY = "enrichment-stale";
let lastAlertAt = 0; // fast path; the AlertState row is what survives restarts/deploys

export function _resetAlertMemory() { lastAlertAt = 0; }

export async function checkEnrichmentFreshness() {
    const report = await getFreshness();
    if (report.healthy) {
        // Back to healthy: forget the last alert so a new outage alerts immediately.
        lastAlertAt = 0;
        try { await prisma.alertState.deleteMany({ where: { key: ALERT_KEY } }); }
        catch (err) { console.error(`[Enrichment] Could not reset stored alert time (${err.message})`); }
        return;
    }
    // No runs recorded at all = freshly deployed, table empty; the first cron run will populate it.
    if (!report.lastRun) return;
    if (Date.now() - lastAlertAt < ALERT_REPEAT_MS) return;

    let dbOk = true;
    try {
        const row = await prisma.alertState.findUnique({ where: { key: ALERT_KEY } });
        if (row && Date.now() - row.lastSentAt.getTime() < ALERT_REPEAT_MS) {
            lastAlertAt = row.lastSentAt.getTime(); // alerted before a restart; don't repeat
            return;
        }
    } catch (err) {
        dbOk = false;
        console.error(`[Enrichment] Could not read stored alert time, using in-memory dedupe only (${err.message})`);
    }

    lastAlertAt = Date.now();
    // Record before sending so a crash mid-send errs towards one missed email, not a repeat.
    if (dbOk) {
        try {
            await prisma.alertState.upsert({
                where: { key: ALERT_KEY },
                create: { key: ALERT_KEY, lastSentAt: new Date(lastAlertAt) },
                update: { lastSentAt: new Date(lastAlertAt) },
            });
        } catch (err) {
            console.error(`[Enrichment] Could not store alert time, using in-memory dedupe only (${err.message})`);
        }
    }
    console.error(`[Enrichment] STALE — no place updated in ${formatHours(report.hoursSinceLastUpdate)} (last successful run ${formatHours(report.hoursSinceLastSuccess)}${report.hoursSinceLastSuccess == null ? "" : " ago"})`);
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
    console.log(`[Enrichment] Catch-up — last success ${report.hoursSinceLastSuccess == null ? "never" : `${report.hoursSinceLastSuccess}h ago`}, starting a run`);
    // runEnrichment takes the DB lock itself, so losing a race with the cron is harmless.
    await runEnrichment({ trigger: "catchup" });
}

// ---- hourly missed-run check ------------------------------------------------------------------------
// The 4am cron lives in this process's memory, so a restart or sleep across 4am silently skips that night.
// The boot catch-up only helps if a boot happens afterwards. This check runs every hour and starts a normal
// run (same lock, same ENRICHMENT_MAX_PER_RUN cap, same executeEnrichmentRun path) when no run of any status
// has STARTED within MISSED_RUN_AFTER_HOURS. It is quiet when nothing is wrong.
export const MISSED_RUN_AFTER_HOURS = 26;
export const MISSED_RUN_CRON = "37 * * * *";           // hourly, not at :00 (the freshness watchdog uses :15)
const HEARTBEAT_EVERY_MS = 24 * 60 * 60 * 1000;

/**
 * Same rule as the boot catch-up: only on Railway (RAILWAY_ENVIRONMENT set) or with ENRICHMENT_CATCHUP=true,
 * so a local server pointed at the real database never starts paid runs. Always off with
 * ENRICHMENT_CATCHUP=false or NODE_ENV=test.
 */
export function missedRunCheckEnabled(env = process.env) {
    if (env.ENRICHMENT_CATCHUP === "false" || env.NODE_ENV === "test") return false;
    return env.ENRICHMENT_CATCHUP === "true" || !!env.RAILWAY_ENVIRONMENT;
}

/**
 * Pure decision. `activity` is getRunActivity(): { lastStartedAt, runningHeartbeatAt }.
 * quiet=true means "nothing is wrong, log nothing".
 */
export function missedRunDecision({ activity, now = Date.now(), enabled = true }) {
    if (!enabled) return { action: "skip", reason: "disabled", quiet: true };
    // A running row only blocks if its heartbeat is fresh; a dead one is abandoned by the lock (acquireRun) when we start.
    const running = activity.runningHeartbeatAt && now - new Date(activity.runningHeartbeatAt).getTime() <= RUN_STALE_AFTER_MS;
    if (running) return { action: "skip", reason: "running", quiet: false };
    if (!activity.lastStartedAt) return { action: "start", reason: "no_run", hoursSinceLastStart: null };
    const hours = (now - new Date(activity.lastStartedAt).getTime()) / 3_600_000;
    if (hours > MISSED_RUN_AFTER_HOURS) return { action: "start", reason: "overdue", hoursSinceLastStart: Math.round(hours * 10) / 10 };
    return { action: "skip", reason: "recent_run", quiet: true, hoursSinceLastStart: hours };
}

let lastHeartbeatLogAt = 0;

export async function checkMissedRun({ now = Date.now(), enabled = missedRunCheckEnabled() } = {}) {
    const activity = await getRunActivity();
    const decision = missedRunDecision({ activity, now, enabled });

    if (decision.action === "start") {
        console.log(`[Enrichment] Missed-run check: ${decision.reason === "no_run" ? "no run has ever started" : `no run started in the last ${decision.hoursSinceLastStart}h`} (limit ${MISSED_RUN_AFTER_HOURS}h) — starting a catchup run`);
        await runEnrichment({ trigger: "catchup" });   // takes the DB lock itself: losing a race is harmless
        return decision;
    }
    if (!decision.quiet) {
        console.log(`[Enrichment] Missed-run check: declined — a run is already in progress`);
    } else if (now - lastHeartbeatLogAt >= HEARTBEAT_EVERY_MS) {
        // Once a day: proof the check is alive, so a silent scheduler is distinguishable from a healthy one.
        lastHeartbeatLogAt = now;
        const h = activity.lastStartedAt ? Math.round((now - new Date(activity.lastStartedAt).getTime()) / 360_000) / 10 : null;
        console.log(`[Enrichment] Heartbeat: missed-run check alive, last run started ${h === null ? "never" : `${h}h ago`}${decision.reason === "disabled" ? " (check disabled)" : ""}`);
    }
    return decision;
}

/** Next 04:00 America/Toronto after `from`, as a Date (DST-safe: scans forward minute by minute). */
export function nextNightlyRun(from = new Date(), hour = 4) {
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Toronto", hour: "2-digit", minute: "2-digit", hour12: false });
    const t = new Date(Math.floor(from.getTime() / 60_000) * 60_000 + 60_000);
    for (let i = 0; i < 26 * 60; i++, t.setTime(t.getTime() + 60_000)) {
        const [h, m] = fmt.format(t).split(":").map(Number);
        if (h === hour && m === 0) return new Date(t);
    }
    return null;
}

/**
 * Central cron registration. All scheduled background jobs are wired up here
 * and started once at boot via startScheduler() (see server.js).
 */
export function startScheduler() {
    startEnrichmentCron();
    const next = nextNightlyRun();
    if (next) console.log(`[Enrichment] Next nightly run: ${next.toISOString()} (04:00 America/Toronto)`);

    if (missedRunCheckEnabled()) {
        cron.schedule(MISSED_RUN_CRON, () => {
            checkMissedRun().catch((err) => console.error("[Enrichment] Missed-run check error:", err.message));
        }, { timezone: "America/Toronto" });
        lastHeartbeatLogAt = Date.now();
        console.log(`[Enrichment] Missed-run check scheduled hourly at :37 — starts a catchup run if none started in ${MISSED_RUN_AFTER_HOURS}h`);
    } else {
        console.log("[Enrichment] Missed-run check not scheduled (needs RAILWAY_ENVIRONMENT or ENRICHMENT_CATCHUP=true; off with ENRICHMENT_CATCHUP=false or NODE_ENV=test)");
    }

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
