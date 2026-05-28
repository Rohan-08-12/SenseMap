import axios from "axios";

const YELP_API_BASE = "https://api.yelp.com/v3";
const FOURSQUARE_API_BASE = "https://api.foursquare.com/v3";

async function fetchYelp(name, lat, lng) {
    try {
        if (!process.env.YELP_API_KEY) return { text: "", yelpId: null };

        const searchRes = await axios.get(`${YELP_API_BASE}/businesses/search`, {
            headers: { Authorization: `Bearer ${process.env.YELP_API_KEY}` },
            params: { term: name, latitude: lat, longitude: lng, limit: 1 },
            timeout: 8000,
        });
        const business = searchRes.data.businesses?.[0];
        if (!business) return { text: "", yelpId: null };

        const reviewsRes = await axios.get(`${YELP_API_BASE}/businesses/${business.id}/reviews`, {
            headers: { Authorization: `Bearer ${process.env.YELP_API_KEY}` },
            params: { limit: 10, sort_by: "newest" },
            timeout: 8000,
        });
        const reviews = reviewsRes.data.reviews ?? [];
        const text = reviews.map((r) => r.text).filter(Boolean).join("\n");
        return { text, yelpId: business.id };
    } catch {
        return { text: "", yelpId: null };
    }
}

async function fetchFoursquare(name, lat, lng) {
    try {
        if (!process.env.FOURSQUARE_API_KEY) return "";

        const searchRes = await axios.get(`${FOURSQUARE_API_BASE}/places/search`, {
            headers: { Authorization: process.env.FOURSQUARE_API_KEY },
            params: { query: name, ll: `${lat},${lng}`, limit: 1 },
            timeout: 8000,
        });
        const place = searchRes.data.results?.[0];
        if (!place) return "";

        const tipsRes = await axios.get(`${FOURSQUARE_API_BASE}/places/${place.fsq_id}/tips`, {
            headers: { Authorization: process.env.FOURSQUARE_API_KEY },
            params: { limit: 5 },
            timeout: 8000,
        });
        const tips = tipsRes.data ?? [];
        return tips.map((t) => t.text).filter(Boolean).join("\n");
    } catch {
        return "";
    }
}

async function fetchReddit(name) {
    try {
        const query = encodeURIComponent(`${name} toronto noise OR crowd OR lighting`);
        const res = await axios.get(
            `https://www.reddit.com/search.json?q=${query}&limit=5&sort=relevance`,
            {
                headers: { "User-Agent": "SenseMap/1.0 (sensory-mapping-app)" },
                timeout: 8000,
            }
        );
        const posts = res.data?.data?.children ?? [];
        const nameLower = name.toLowerCase();
        return posts
            .filter((p) => {
                const title = (p.data.title ?? "").toLowerCase();
                const body = (p.data.selftext ?? "").toLowerCase();
                return title.includes(nameLower) || body.includes(nameLower);
            })
            .map((p) => `${p.data.title}. ${p.data.selftext}`.trim())
            .join("\n");
    } catch {
        return "";
    }
}

export async function fetchAllSources({ name, latitude, longitude, existingYelpId = null }) {
    const [yelpResult, foursquareText, redditText] = await Promise.all([
        existingYelpId
            ? fetchYelpById(existingYelpId).then((text) => ({ text, yelpId: existingYelpId }))
            : fetchYelp(name, latitude, longitude),
        fetchFoursquare(name, latitude, longitude),
        fetchReddit(name),
    ]);

    const parts = [];
    const sources = [];

    if (yelpResult.text) {
        parts.push(yelpResult.text);
        sources.push("yelp");
    }
    if (foursquareText) {
        parts.push(foursquareText);
        sources.push("foursquare");
    }
    if (redditText) {
        parts.push(redditText);
        sources.push("reddit");
    }

    const combinedText = parts.join("\n\n");
    return {
        combinedText,
        sources,
        characterCount: combinedText.length,
        yelpId: yelpResult.yelpId,
    };
}

async function fetchYelpById(yelpId) {
    try {
        const res = await axios.get(`${YELP_API_BASE}/businesses/${yelpId}/reviews`, {
            headers: { Authorization: `Bearer ${process.env.YELP_API_KEY}` },
            params: { limit: 10, sort_by: "newest" },
            timeout: 8000,
        });
        const reviews = res.data.reviews ?? [];
        return reviews.map((r) => r.text).filter(Boolean).join("\n");
    } catch {
        return "";
    }
}
