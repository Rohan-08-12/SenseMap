/**
 * Admin Notification Emails (Resend)
 * Fire-and-forget alerts to the site owner — e.g. a new email-digest subscriber.
 * Silently no-ops if RESEND_API_KEY / ADMIN_NOTIFY_EMAIL aren't configured, so this
 * never blocks or breaks the request it's called from.
 */
import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

// Resend's sandbox "from" address works without a verified domain, but can only
// deliver to the account owner's own inbox — fine here since notifications are for us.
const FROM = process.env.RESEND_FROM || "SenseMap <onboarding@resend.dev>";

export async function notifyNewSubscriber({ email, source }) {
    if (!resend || !process.env.ADMIN_NOTIFY_EMAIL) return;

    try {
        // The Resend SDK resolves with { data, error } instead of throwing on API errors —
        // check both, or failures (bad recipient, rate limit, etc.) go unnoticed.
        const { data, error } = await resend.emails.send({
            from: FROM,
            to: process.env.ADMIN_NOTIFY_EMAIL,
            subject: "New SenseMap subscriber",
            text: `${email} just subscribed to the weekly quiet-spots digest.\n\nSource: ${source || "unknown"}\nTime: ${new Date().toISOString()}`,
        });
        if (error) {
            console.error("Resend rejected subscriber notification email:", error);
        } else {
            console.log("Subscriber notification email queued:", data?.id);
        }
    } catch (error) {
        console.error("Error sending subscriber notification email:", error);
    }
}

/**
 * The only address the stale-watchdog email may go to: ADMIN_NOTIFY_EMAIL, as one plain address.
 * Never a subscriber, audience or any address from the database. Unset/empty (or a list of addresses) = no send.
 */
export function adminRecipient(env = process.env) {
    const to = (env.ADMIN_NOTIFY_EMAIL || "").trim();
    if (!to || /[,;\s]/.test(to)) return null;
    return to;
}

export async function notifyEnrichmentStale({ hoursSinceLastSuccess, hoursSinceLastUpdate, lastRun }) {
    if (!resend) return;
    const to = adminRecipient();
    if (!to) {
        console.warn("[Enrichment] Stale alert not sent: ADMIN_NOTIFY_EMAIL is not set to a single address");
        return;
    }

    try {
        const ago = (h) => (h == null ? "never" : `${h}h ago`);
        const last = lastRun
            ? `${lastRun.status} (trigger: ${lastRun.trigger}, started ${new Date(lastRun.startedAt).toISOString()}, failed: ${lastRun.failed}/${lastRun.planned})${lastRun.errorMessage ? `\nError: ${lastRun.errorMessage}` : ""}`
            : "none recorded";
        const { error } = await resend.emails.send({
            from: FROM,
            to,
            subject: "SenseMap: no places updated by enrichment in 36h",
            text: `Last time any place was updated: ${ago(hoursSinceLastUpdate)}\nLast run that finished successfully (even if it updated nothing): ${ago(hoursSinceLastSuccess)}\nMost recent run: ${last}\n\nCheck GET /enrichment/freshness (x-n8n-secret header) and the Railway logs.`,
        });
        if (error) console.error("Resend rejected enrichment-stale email:", error);
    } catch (error) {
        console.error("Error sending enrichment-stale email:", error);
    }
}
