import cron from "node-cron";
import { startEnrichmentCron } from "./enrichmentCron.js";
import { sendWeeklyDigest } from "../jobs/sendWeeklyDigest.js";

/**
 * Central cron registration. All scheduled background jobs are wired up here
 * and started once at boot via startScheduler() (see server.js).
 */
export function startScheduler() {
    startEnrichmentCron();

    // Weekly digest — every Sunday at 9am Toronto time
    cron.schedule("0 9 * * 0", () => {
        console.log("[Digest] Cron triggered");
        sendWeeklyDigest().catch((err) => console.error("[Digest] Cron error:", err.message));
    }, { timezone: "America/Toronto" });

    console.log("[Digest] Cron scheduled — weekly, Sunday 9am Toronto");
}
