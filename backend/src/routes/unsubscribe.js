import express from "express";
import prisma from "../lib/prisma.js";

const router = express.Router();

function unsubscribePage({ heading, message }) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>SenseMap</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background: #f7f5f0; color: #1f2937; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; box-sizing: border-box; }
  .card { background: #fff; border-radius: 16px; padding: 40px 32px; max-width: 420px; text-align: center; box-shadow: 0 16px 32px rgba(15, 23, 32, 0.08); }
  h1 { font-size: 20px; margin: 0 0 12px; }
  p { font-size: 14px; color: #6b7280; margin: 0; line-height: 1.5; }
  a { color: #5a8f6e; }
</style>
</head>
<body>
  <div class="card">
    <h1>${heading}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;
}

// GET /unsubscribe?email=xxx — one-click unsubscribe link used in digest emails (public)
router.get("/", async (req, res) => {
    const email = typeof req.query.email === "string" ? req.query.email.trim().toLowerCase() : "";

    if (!email) {
        return res.status(400).send(unsubscribePage({
            heading: "Missing email",
            message: "This unsubscribe link is missing an email address.",
        }));
    }

    try {
        // updateMany rather than update — an unknown/already-inactive email just no-ops
        // instead of erroring, so this stays a safe, idempotent link to click more than once.
        await prisma.emailSubscriber.updateMany({
            where: { email },
            data: { active: false },
        });

        res.send(unsubscribePage({
            heading: "You've been unsubscribed",
            message: `${email} won't receive any more SenseMap emails. You can re-subscribe anytime from sensemap.app.`,
        }));
    } catch (error) {
        console.error("Error unsubscribing:", error);
        res.status(500).send(unsubscribePage({
            heading: "Something went wrong",
            message: "We couldn't process your request. Please try again later.",
        }));
    }
});

export default router;
