/**
 * Weekly Email Digest
 * Sends the week's top 5 highest-rated new/updated locations to every active
 * EmailSubscriber. Triggered by the Sunday 9am Toronto cron in lib/scheduler.js.
 *
 * Also runnable directly for a manual/test send:
 *   node src/jobs/sendWeeklyDigest.js
 */
import { Resend } from "resend";
import prisma from "../lib/prisma.js";
import { getDisplayScore } from "../lib/scores.js";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.RESEND_FROM || "SenseMap <onboarding@resend.dev>";
const API_BASE_URL = process.env.API_BASE_URL || "https://api.sensemap.app";
const SITE_URL = "https://sensemap.app";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DIGEST_SIZE = 5;
const SEND_DELAY_MS = 350; // stay well under Resend's default rate limit

function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
}

/**
 * Top comfort-scored locations added or updated in the last 7 days.
 * Reuses the same community/AI-estimated/category blending logic as GET /rankings
 * (via getDisplayScore) so the digest agrees with what the map itself shows.
 */
async function getTopLocationsThisWeek() {
    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);

    const candidates = await prisma.location.findMany({
        where: {
            OR: [{ createdAt: { gte: cutoff } }, { updatedAt: { gte: cutoff } }],
        },
        select: {
            id: true, name: true, category: true,
            estimatedNoiseScore: true, estimatedLightingScore: true, estimatedCrowdScore: true,
            sensoryScores: {
                select: { noiseScore: true, lightingScore: true, crowdScore: true, comfortScore: true, reviewCount: true },
            },
        },
    });

    return candidates
        .map((loc) => {
            const s = loc.sensoryScores;
            const display = getDisplayScore({
                reviewCount: s?.reviewCount ?? 0,
                noiseScore: s?.noiseScore ?? null,
                lightingScore: s?.lightingScore ?? null,
                crowdScore: s?.crowdScore ?? null,
                comfortScore: s?.comfortScore ?? null,
                estimatedNoiseScore: loc.estimatedNoiseScore,
                estimatedLightingScore: loc.estimatedLightingScore,
                estimatedCrowdScore: loc.estimatedCrowdScore,
            });
            if (display.comfort == null) return null;
            return { id: loc.id, name: loc.name, category: loc.category, comfort: display.comfort };
        })
        .filter(Boolean)
        .sort((a, b) => b.comfort - a.comfort)
        .slice(0, DIGEST_SIZE);
}

function buildDigestHtml(locations, email) {
    const unsubscribeUrl = `${API_BASE_URL}/unsubscribe?email=${encodeURIComponent(email)}`;

    const rows = locations.map((loc) => `
    <tr>
      <td style="padding: 14px 0; border-bottom: 1px solid #e5e7eb;">
        <a href="${SITE_URL}" style="font-size: 16px; font-weight: 600; color: #1f2937; text-decoration: none;">${escapeHtml(loc.name)}</a>
        <div style="font-size: 13px; color: #6b7280; margin-top: 2px;">${escapeHtml(loc.category || "Sensory-friendly spot")} · Comfort ${loc.comfort.toFixed(1)}/5</div>
      </td>
    </tr>`).join("");

    return `<div style="font-family: -apple-system, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1f2937;">
    <h2 style="font-size: 18px; margin-bottom: 8px;">5 quiet spots in Toronto this week 🗺️</h2>
    <p style="font-size: 14px; color: #4b5563; margin-bottom: 20px;">
      Here are this week's top sensory-friendly spots in Toronto.
    </p>
    <table style="width: 100%; border-collapse: collapse;">
      ${rows}
    </table>
    <p style="margin-top: 24px;">
      <a href="${SITE_URL}" style="display: inline-block; padding: 10px 18px; background: #5a8f6e; color: #fff; border-radius: 8px; text-decoration: none; font-size: 14px; font-weight: 600;">
        Open SenseMap
      </a>
    </p>
    <p style="font-size: 12px; color: #9ca3af; margin-top: 32px;">
      You're receiving this because you signed up for quiet-spot updates at sensemap.app.
      <a href="${unsubscribeUrl}" style="color: #9ca3af;">Unsubscribe</a>
    </p>
  </div>`;
}

export async function sendWeeklyDigest() {
    if (!resend) {
        console.log("[Digest] RESEND_API_KEY not set — skipping send.");
        return { sent: 0, failed: 0, skipped: true };
    }

    const locations = await getTopLocationsThisWeek();
    if (locations.length === 0) {
        console.log("[Digest] No new/updated locations in the last 7 days — skipping send.");
        return { sent: 0, failed: 0, skipped: true };
    }

    const subscribers = await prisma.emailSubscriber.findMany({
        where: { active: true },
        select: { email: true },
    });
    if (subscribers.length === 0) {
        console.log("[Digest] No active subscribers — nothing to send.");
        return { sent: 0, failed: 0, skipped: true };
    }

    let sent = 0, failed = 0;

    for (let i = 0; i < subscribers.length; i++) {
        const { email } = subscribers[i];
        try {
            const { error } = await resend.emails.send({
                from: FROM,
                to: email,
                subject: "5 quiet spots in Toronto this week 🗺️",
                html: buildDigestHtml(locations, email),
            });
            if (error) {
                console.error(`[Digest] Resend rejected send to ${email}:`, error);
                failed++;
            } else {
                sent++;
            }
        } catch (err) {
            console.error(`[Digest] Failed to send to ${email}:`, err.message);
            failed++;
        }

        if (i < subscribers.length - 1) {
            await new Promise((r) => setTimeout(r, SEND_DELAY_MS));
        }
    }

    console.log(`[Digest] Done — sent: ${sent}, failed: ${failed}, locations featured: ${locations.length}`);
    return { sent, failed, locationCount: locations.length };
}

// Allow a manual/test run: `node src/jobs/sendWeeklyDigest.js`
if (import.meta.url === `file://${process.argv[1]}`) {
    sendWeeklyDigest()
        .then(() => prisma.$disconnect())
        .catch((err) => {
            console.error("[Digest] Manual run failed:", err);
            process.exit(1);
        });
}
