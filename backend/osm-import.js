/**
 * SenseMap — OSM Import Script
 * ─────────────────────────────────────────────────────────────────────────────
 * Pulls real Toronto locations from OpenStreetMap via Overpass API,
 * assigns static category-based sensory defaults, and seeds your
 * Supabase/PostgreSQL database via Prisma.
 *
 * No Gemini calls — scores are honest category defaults, clearly marked
 * as unverified until real community check-ins come in.
 *
 * Usage:
 *   node osm-import.js              ← full import (all categories)
 *   node osm-import.js --dry-run    ← preview results, no DB writes
 *   node osm-import.js --category cafe  ← single category only
 *
 * Requirements:
 *   npm install node-fetch dotenv
 *   (Prisma client already in your project)
 */

import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';

dotenv.config();

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CATEGORY_FILTER = args.includes('--category')
    ? args[args.indexOf('--category') + 1]
    : null;

// ── Toronto bounding box ──────────────────────────────────────────────────────
// south, west, north, east
const TORONTO_BBOX = '43.58,-79.64,43.86,-79.11';

// ── OSM category definitions ──────────────────────────────────────────────────
const CATEGORIES = [
    {
        key: 'cafe',
        label: 'Cafe',
        query: `node["amenity"="cafe"](${TORONTO_BBOX});`,
    },
    {
        key: 'library',
        label: 'Library',
        query: `node["amenity"="library"](${TORONTO_BBOX});
            way["amenity"="library"](${TORONTO_BBOX});`,
    },
    {
        key: 'community_centre',
        label: 'Community Centre',
        query: `node["amenity"="community_centre"](${TORONTO_BBOX});
            way["amenity"="community_centre"](${TORONTO_BBOX});`,
    },
    {
        key: 'park',
        label: 'Park',
        query: `node["leisure"="park"](${TORONTO_BBOX});
            way["leisure"="park"](${TORONTO_BBOX});`,
    },
    {
        key: 'mall',
        label: 'Shopping Mall',
        query: `node["shop"="mall"](${TORONTO_BBOX});
            way["shop"="mall"](${TORONTO_BBOX});`,
    },
    {
        key: 'museum',
        label: 'Museum',
        query: `node["tourism"="museum"](${TORONTO_BBOX});
            way["tourism"="museum"](${TORONTO_BBOX});`,
    },
];

// ── Static sensory defaults per category ─────────────────────────────────────
// Honest, transparent estimates — not AI hallucinations.
// Scores: 1.0 = very low, 5.0 = very high
// These show as "No visits yet" in the UI until real check-ins come in.
const CATEGORY_DEFAULTS = {
    'Cafe': { noiseScore: 3.0, lightingScore: 3.5, crowdScore: 3.0, comfortScore: 2.8 },
    'Library': { noiseScore: 1.5, lightingScore: 3.0, crowdScore: 1.8, comfortScore: 4.2 },
    'Community Centre': { noiseScore: 2.5, lightingScore: 3.0, crowdScore: 2.5, comfortScore: 3.2 },
    'Park': { noiseScore: 2.0, lightingScore: 4.5, crowdScore: 2.0, comfortScore: 3.8 },
    'Shopping Mall': { noiseScore: 4.0, lightingScore: 4.5, crowdScore: 4.2, comfortScore: 1.8 },
    'Museum': { noiseScore: 2.0, lightingScore: 3.5, crowdScore: 2.5, comfortScore: 3.5 },
};

function getBaselineScores(category) {
    return CATEGORY_DEFAULTS[category] ?? {
        noiseScore: 3.0, lightingScore: 3.0, crowdScore: 3.0, comfortScore: 3.0,
    };
}

// ── Overpass API fetch ────────────────────────────────────────────────────────
async function fetchOSMPlaces(category) {
    const query = `
    [out:json][timeout:30];
    (
      ${category.query}
    );
    out center tags;
  `;

    const url = 'https://overpass-api.de/api/interpreter';
    console.log(`\n📡 Fetching ${category.label} locations from OSM...`);

    const res = await fetch(url, {
        method: 'POST',
        body: query,
        headers: { 'Content-Type': 'text/plain' },
    });

    if (!res.ok) throw new Error(`Overpass API error: ${res.status}`);

    const data = await res.json();
    return data.elements || [];
}

// ── Parse OSM element into a clean place object ───────────────────────────────
function parseOSMElement(el, categoryLabel) {
    const tags = el.tags || {};

    // Ways have a center, nodes have lat/lon directly
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;

    if (!lat || !lon) return null;

    // Skip unnamed places — not useful for users
    const name = tags.name || tags['name:en'];
    if (!name) return null;

    // Build address from OSM addr tags
    const addressParts = [
        tags['addr:housenumber'],
        tags['addr:street'],
        tags['addr:city'] || 'Toronto',
        tags['addr:province'] || 'ON',
    ].filter(Boolean);
    const address = addressParts.length > 1 ? addressParts.join(' ') : null;

    // Wikimedia Commons image — free, no ToS issues
    const wikimediaTag = tags['wikimedia_commons'] || tags['image'];
    const imageUrl = wikimediaTag ? resolveWikimediaUrl(wikimediaTag) : null;

    return {
        osmId: `osm_${el.type}_${el.id}`,
        name,
        category: categoryLabel,
        address,
        latitude: lat,
        longitude: lon,
        imageUrl,
    };
}

// ── Resolve Wikimedia Commons tag to a usable image URL ──────────────────────
function resolveWikimediaUrl(tag) {
    if (!tag) return null;
    if (tag.startsWith('http')) return tag;
    if (tag.startsWith('File:')) {
        const filename = tag.replace('File:', '').replace(/ /g, '_');
        return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=800`;
    }
    return null;
}

// ── Write a single place to the database via Prisma ──────────────────────────
async function upsertPlace(place, scores) {
    const location = await prisma.location.upsert({
        where: { googlePlaceId: place.osmId },
        update: {
            latitude: place.latitude,
            longitude: place.longitude,
            imageUrl: place.imageUrl ?? undefined,
        },
        create: {
            googlePlaceId: place.osmId,
            name: place.name,
            category: place.category,
            address: place.address,
            latitude: place.latitude,
            longitude: place.longitude,
            imageUrl: place.imageUrl,
            // description flags this as unverified so the UI can show
            // "No visits yet — be the first" instead of fake scores
            description: `No community data yet — category default scores applied`,
        },
    });

    await prisma.sensoryScore.upsert({
        where: { locationId: location.id },
        update: {
            noiseScore: scores.noiseScore,
            lightingScore: scores.lightingScore,
            crowdScore: scores.crowdScore,
            comfortScore: scores.comfortScore,
        },
        create: {
            locationId: location.id,
            noiseScore: scores.noiseScore,
            lightingScore: scores.lightingScore,
            crowdScore: scores.crowdScore,
            comfortScore: scores.comfortScore,
            reviewCount: 0, // stays 0 until a real user checks in
        },
    });

    return location;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
    console.log('');
    console.log('╔════════════════════════════════════════╗');
    console.log('║     SenseMap — OSM Import Script       ║');
    console.log('╚════════════════════════════════════════╝');
    if (DRY_RUN) console.log('🔍  DRY RUN — no database writes\n');

    const categoriesToRun = CATEGORY_FILTER
        ? CATEGORIES.filter((c) => c.key === CATEGORY_FILTER)
        : CATEGORIES;

    if (categoriesToRun.length === 0) {
        console.error(`❌ Unknown category: ${CATEGORY_FILTER}`);
        console.log(`   Valid options: ${CATEGORIES.map((c) => c.key).join(', ')}`);
        process.exit(1);
    }

    let totalImported = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const category of categoriesToRun) {
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`📂  Category: ${category.label}`);
        console.log(`${'─'.repeat(50)}`);

        let elements;
        try {
            elements = await fetchOSMPlaces(category);
        } catch (err) {
            console.error(`  ❌ OSM fetch failed: ${err.message}`);
            continue;
        }

        const places = elements
            .map((el) => parseOSMElement(el, category.label))
            .filter(Boolean)
            .slice(0, 500); // Limit to 500 places per category

        console.log(`  ${elements.length} raw elements → ${places.length} valid named places`);

        for (let i = 0; i < places.length; i++) {
            const place = places[i];
            const progress = `[${i + 1}/${places.length}]`;

            try {
                if (DRY_RUN) {
                    console.log(`  ${progress} ✓ ${place.name} (${place.latitude.toFixed(4)}, ${place.longitude.toFixed(4)})`);
                    if (place.imageUrl) console.log(`           🖼️  ${place.imageUrl}`);
                    totalImported++;
                    continue;
                }

                // Skip if already in DB
                const existing = await prisma.location.findUnique({
                    where: { googlePlaceId: place.osmId },
                });
                if (existing) {
                    console.log(`  ${progress} ⏭️  Already exists: ${place.name}`);
                    totalSkipped++;
                    continue;
                }

                // Get static category defaults — no API call needed
                const scores = getBaselineScores(place.category);

                await upsertPlace(place, scores);
                console.log(`  ${progress} ✅ ${place.name}`);
                totalImported++;

            } catch (err) {
                console.error(`  ${progress} ❌ ${place.name} — ${err.message}`);
                totalFailed++;
            }
        }
    }

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log('\n');
    console.log('╔════════════════════════════════════════╗');
    console.log('║           Import Complete              ║');
    console.log('╠════════════════════════════════════════╣');
    console.log(`║  ✅ Imported : ${String(totalImported).padEnd(24)}║`);
    console.log(`║  ⏭️  Skipped  : ${String(totalSkipped).padEnd(24)}║`);
    console.log(`║  ❌ Failed   : ${String(totalFailed).padEnd(24)}║`);
    console.log('╚════════════════════════════════════════╝');

    if (!DRY_RUN) {
        console.log('\n💡 Next steps:');
        console.log('   1. Check Supabase — locations table should be populated');
        console.log('   2. reviewCount=0 → show "No visits yet" badge in UI');
        console.log('   3. Re-run monthly to pick up new OSM additions');
        console.log('   4. Wire up check-in system so real data starts replacing defaults');
    }
}

main()
    .catch((err) => {
        console.error('\n💥 Fatal error:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });