import app from "./app.js";
import dotenv from "dotenv";

dotenv.config();

const REQUIRED_ENV = [
    "DATABASE_URL",
    "AUTH0_AUDIENCE",
    "AUTH0_ISSUER_BASE_URL",
    "GEMINI_API_KEY",
];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    process.exit(1);
}

const PORT = process.env.PORT || 3000;

import prisma from "./lib/prisma.js";
import { startScheduler } from "./lib/scheduler.js";

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
    prisma.$connect()
        .then(() => {
            console.log("Database connected.");
            startScheduler();
        })
        .catch((err) => {
            console.error("Database connection failed:", err.message);
            process.exit(1);
        });
});