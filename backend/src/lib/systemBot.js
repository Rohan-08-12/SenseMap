import prisma from "./prisma.js";

export const SYSTEM_BOT = {
    auth0Id: "system|sensemap-bot",
    email: "bot@sensemap.app",
    username: "SenseMap Bot",
};

export async function getSystemUser() {
    return prisma.user.upsert({
        where: { auth0Id: SYSTEM_BOT.auth0Id },
        update: {},
        create: SYSTEM_BOT,
    });
}
