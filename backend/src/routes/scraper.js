import express from "express";
import { fetchAllSources } from "../services/scraper.js";
import { requireN8nSecret } from "../middleware/n8nAuth.js";

const router = express.Router();

// POST /scraper/location — fetch review text from Yelp, Foursquare, Reddit in parallel
router.post("/location", requireN8nSecret, async (req, res) => {
    try {
        const { name, address, latitude, longitude } = req.body;
        if (!name || latitude == null || longitude == null) {
            return res.status(400).json({ error: "name, latitude, and longitude are required" });
        }

        const result = await fetchAllSources({ name, address, latitude: parseFloat(latitude), longitude: parseFloat(longitude) });
        res.json(result);
    } catch (error) {
        console.error("Scraper error:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
