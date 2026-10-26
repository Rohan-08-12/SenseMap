import prisma from "./prisma.js";

export const SYSTEM_BOT = {
    auth0Id: process.env.SYSTEM_BOT_AUTH0_ID || "system|sensemap-bot",
    email: "bot@sensemap.app",
    username: "SenseMap Bot",
};

// Bot/seed reviews have been written under two different emails over time; treat both as bot.
export const BOT_EMAILS = new Set([SYSTEM_BOT.email, "bot@sensorysafe.com"]);

// Server-side bot detection so clients never need reviewer emails to label bot reviews.
export function isBotReview(review, user) {
    return review?.isAiGenerated === true
        || BOT_EMAILS.has(user?.email)
        || user?.auth0Id === SYSTEM_BOT.auth0Id;
}

export async function getSystemUser() {
    return prisma.user.upsert({
        where: { auth0Id: SYSTEM_BOT.auth0Id },
        update: {},
        create: SYSTEM_BOT,
    });
}
