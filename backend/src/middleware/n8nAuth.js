export function requireN8nSecret(req, res, next) {
    const secret = req.headers["x-n8n-secret"];
    if (!process.env.N8N_WEBHOOK_SECRET || secret !== process.env.N8N_WEBHOOK_SECRET) {
        return res.status(401).json({ error: "Unauthorized" });
    }
    next();
}
