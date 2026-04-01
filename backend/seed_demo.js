/**
 * seed_demo.js — Creates 15 showcase Toronto locations
 * - 5 locations with reviews + computed sensory scores
 * - 10 locations with pre-set sensory scores (no reviews)
 *
 * Run from backend/: node seed_demo.js
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// ─── Demo user ───────────────────────────────────────────────
const DEMO_USER = {
  auth0Id: "auth0|demo_seed_user",
  email: "demo@sensemap.app",
  username: "SenseMap Demo",
};

// ─── 5 locations WITH reviews ────────────────────────────────
// noiseLevel / lightingLevel / crowdLevel: 1–10 (lower = calmer)
// rating: 1–10 (higher = more comfortable)
const LOCATIONS_WITH_REVIEWS = [
  {
    googlePlaceId: "demo_toronto_reference_library",
    name: "Toronto Reference Library",
    category: "Library",
    address: "789 Yonge St, Toronto, ON",
    description: "A large, quiet public research library with open atrium and natural light. Popular with students and researchers seeking a calm environment.",
    latitude: 43.6723,
    longitude: -79.3868,
    reviews: [
      { noiseLevel: 2, lightingLevel: 5, crowdLevel: 3, rating: 9, bodyText: "Incredibly peaceful. The whisper zones are amazing for focus. Lighting is soft and the atrium lets in natural light without glare.", visitTime: "morning" },
      { noiseLevel: 3, lightingLevel: 4, crowdLevel: 4, rating: 8, bodyText: "Very calm library, minimal sensory overwhelm. The study rooms are quiet and the staff are helpful and understanding.", visitTime: "afternoon" },
      { noiseLevel: 2, lightingLevel: 5, crowdLevel: 2, rating: 9, bodyText: "My go-to spot. Huge space so never feels cramped. Early morning is the best time — almost empty.", visitTime: "morning" },
    ],
  },
  {
    googlePlaceId: "demo_high_park",
    name: "High Park",
    category: "Park",
    address: "1873 Bloor St W, Toronto, ON",
    description: "Toronto's largest park with forests, gardens, and trails. Offers wide open spaces to decompress away from urban noise.",
    latitude: 43.6465,
    longitude: -79.4637,
    reviews: [
      { noiseLevel: 2, lightingLevel: 3, crowdLevel: 3, rating: 9, bodyText: "The inner forest trails are wonderfully quiet. Far from the city noise. Just birdsong and rustling leaves.", visitTime: "morning" },
      { noiseLevel: 3, lightingLevel: 4, crowdLevel: 5, rating: 8, bodyText: "Very grounding park. Weekday mornings are the calmest. Avoid the main entrance on weekends.", visitTime: "morning" },
    ],
  },
  {
    googlePlaceId: "demo_scarborough_bluffs",
    name: "Scarborough Bluffs Park",
    category: "Park",
    address: "Brimley Rd S, Scarborough, ON",
    description: "Dramatic lakeside cliffs with trails and a quieter beach. Far from city crowds with natural soundscape.",
    latitude: 43.7022,
    longitude: -79.2346,
    reviews: [
      { noiseLevel: 2, lightingLevel: 3, crowdLevel: 2, rating: 9, bodyText: "The most peaceful place in Toronto. Waves, wind, birdsong. Zero urban noise if you go early.", visitTime: "morning" },
      { noiseLevel: 2, lightingLevel: 4, crowdLevel: 2, rating: 9, bodyText: "Stunning cliffs and lake views. Very low crowds on weekdays. Lighting is natural — no harsh artificial lights.", visitTime: "afternoon" },
      { noiseLevel: 3, lightingLevel: 4, crowdLevel: 3, rating: 8, bodyText: "Long walk from the parking lot keeps the crowds low. The bluffs themselves have a calming effect.", visitTime: "afternoon" },
    ],
  },
  {
    googlePlaceId: "demo_evergreen_brick_works",
    name: "Evergreen Brick Works",
    category: "Community Centre",
    address: "550 Bayview Ave, Toronto, ON",
    description: "Industrial heritage site converted to community and nature space. Surrounded by the Don Valley with trails and a farmers market.",
    latitude: 43.6859,
    longitude: -79.3621,
    reviews: [
      { noiseLevel: 3, lightingLevel: 4, crowdLevel: 3, rating: 8, bodyText: "Lovely blend of nature and reclaimed architecture. The outdoor parts feel open and calm. Farmers market can be busy but manageable.", visitTime: "morning" },
      { noiseLevel: 4, lightingLevel: 5, crowdLevel: 4, rating: 7, bodyText: "Good energy here. The indoor exhibition space can echo a bit on busy days. Best to visit outside market days for calm.", visitTime: "afternoon" },
    ],
  },
  {
    googlePlaceId: "demo_toronto_botanical_garden",
    name: "Toronto Botanical Garden",
    category: "Park",
    address: "777 Lawrence Ave E, Toronto, ON",
    description: "A serene botanical garden with themed gardens, gentle pathways, and lush greenery. Very low foot traffic most days.",
    latitude: 43.7303,
    longitude: -79.3608,
    reviews: [
      { noiseLevel: 2, lightingLevel: 4, crowdLevel: 2, rating: 9, bodyText: "Quiet, beautiful, uncrowded. The structured garden zones feel predictable and calming. No loud surprises.", visitTime: "morning" },
      { noiseLevel: 2, lightingLevel: 3, crowdLevel: 2, rating: 9, bodyText: "My favourite sensory refuge in the city. Natural light, soft fragrance, barely anyone there on weekdays.", visitTime: "afternoon" },
    ],
  },
];

// ─── 10 locations WITHOUT reviews (pre-set scores) ───────────
// These show up on the heatmap and rankings without user reviews
const LOCATIONS_NO_REVIEWS = [
  {
    googlePlaceId: "demo_distillery_district",
    name: "Distillery District",
    category: "Outdoor Market",
    address: "55 Mill St, Toronto, ON",
    description: "Historic Victorian industrial district with boutiques and cafes. Car-free cobblestone streets.",
    latitude: 43.6503,
    longitude: -79.3596,
    noiseScore: 5, lightingScore: 5, crowdScore: 5, comfortScore: 5,
  },
  {
    googlePlaceId: "demo_trinity_bellwoods",
    name: "Trinity Bellwoods Park",
    category: "Park",
    address: "790 Queen St W, Toronto, ON",
    description: "Popular west-end park with a mix of open lawns and tree canopy. Busy on weekends, calm on weekday mornings.",
    latitude: 43.6475,
    longitude: -79.4186,
    noiseScore: 4, lightingScore: 3, crowdScore: 4, comfortScore: 6,
  },
  {
    googlePlaceId: "demo_harbourfront_centre",
    name: "Harbourfront Centre",
    category: "Community Centre",
    address: "235 Queens Quay W, Toronto, ON",
    description: "Lakefront arts and culture centre with open waterfront walkways. Views of Lake Ontario with fresh air.",
    latitude: 43.6385,
    longitude: -79.3831,
    noiseScore: 4, lightingScore: 4, crowdScore: 4, comfortScore: 6,
  },
  {
    googlePlaceId: "demo_kensington_market",
    name: "Kensington Market",
    category: "Market",
    address: "Kensington Ave, Toronto, ON",
    description: "Eclectic open-air market neighbourhood. Vibrant and colourful. Can be stimulating — best visited early.",
    latitude: 43.6546,
    longitude: -79.4005,
    noiseScore: 6, lightingScore: 5, crowdScore: 6, comfortScore: 4,
  },
  {
    googlePlaceId: "demo_nathan_phillips_square",
    name: "Nathan Phillips Square",
    category: "Public Space",
    address: "100 Queen St W, Toronto, ON",
    description: "Iconic city hall plaza with seasonal skating rink. Open and flat with lots of sky above.",
    latitude: 43.6529,
    longitude: -79.3832,
    noiseScore: 5, lightingScore: 6, crowdScore: 5, comfortScore: 5,
  },
  {
    googlePlaceId: "demo_casa_loma",
    name: "Casa Loma",
    category: "Museum",
    address: "1 Austin Terrace, Toronto, ON",
    description: "Gothic Revival castle with gardens and secret tunnels. Structured layout helps with navigation.",
    latitude: 43.6780,
    longitude: -79.4094,
    noiseScore: 4, lightingScore: 4, crowdScore: 5, comfortScore: 6,
  },
  {
    googlePlaceId: "demo_st_lawrence_market",
    name: "St. Lawrence Market",
    category: "Market",
    address: "93 Front St E, Toronto, ON",
    description: "Historic indoor market with vendors and prepared foods. Very busy Saturday mornings — visit weekday afternoons for calm.",
    latitude: 43.6488,
    longitude: -79.3715,
    noiseScore: 6, lightingScore: 5, crowdScore: 7, comfortScore: 4,
  },
  {
    googlePlaceId: "demo_ripleys_aquarium",
    name: "Ripley's Aquarium of Canada",
    category: "Aquarium",
    address: "288 Bremner Blvd, Toronto, ON",
    description: "Large aquarium near CN Tower. Dark, controlled lighting in most areas. Sensory-friendly mornings available.",
    latitude: 43.6424,
    longitude: -79.3862,
    noiseScore: 4, lightingScore: 3, crowdScore: 5, comfortScore: 6,
  },
  {
    googlePlaceId: "demo_ago",
    name: "Art Gallery of Ontario",
    category: "Museum",
    address: "317 Dundas St W, Toronto, ON",
    description: "World-class art museum with Frank Gehry architecture. Gallery spaces are quiet with controlled lighting.",
    latitude: 43.6537,
    longitude: -79.3925,
    noiseScore: 3, lightingScore: 4, crowdScore: 4, comfortScore: 7,
  },
  {
    googlePlaceId: "demo_toronto_islands",
    name: "Toronto Islands Park",
    category: "Park",
    address: "Toronto Islands, Toronto, ON",
    description: "Car-free island parks across from downtown. Accessible by ferry. Natural soundscape, minimal city noise.",
    latitude: 43.6216,
    longitude: -79.3793,
    noiseScore: 2, lightingScore: 3, crowdScore: 3, comfortScore: 8,
  },
];

// ─── Main seed function ───────────────────────────────────────
async function seed() {
  console.log("🌱 Starting demo seed...\n");

  // 1. Upsert demo user
  console.log("Creating demo user...");
  const user = await prisma.user.upsert({
    where: { auth0Id: DEMO_USER.auth0Id },
    update: {},
    create: DEMO_USER,
  });
  console.log(`  ✓ User: ${user.username} (${user.id})\n`);

  // 2. Seed locations WITH reviews
  console.log("Creating 5 locations with reviews...");
  for (const loc of LOCATIONS_WITH_REVIEWS) {
    // Upsert location
    const location = await prisma.location.upsert({
      where: { googlePlaceId: loc.googlePlaceId },
      update: { name: loc.name, category: loc.category, address: loc.address, description: loc.description, latitude: loc.latitude, longitude: loc.longitude },
      create: { googlePlaceId: loc.googlePlaceId, name: loc.name, category: loc.category, address: loc.address, description: loc.description, latitude: loc.latitude, longitude: loc.longitude },
    });

    // Delete existing reviews from demo user for this location (idempotency)
    await prisma.review.deleteMany({ where: { locationId: location.id, userId: user.id } });

    // Create reviews
    for (const r of loc.reviews) {
      await prisma.review.create({
        data: {
          userId: user.id,
          locationId: location.id,
          bodyText: r.bodyText,
          rating: r.rating,
          noiseLevel: r.noiseLevel,
          lightingLevel: r.lightingLevel,
          crowdLevel: r.crowdLevel,
          visitTime: r.visitTime,
          aiSentiment: r.rating >= 8 ? "positive" : r.rating >= 5 ? "neutral" : "negative",
          aiTags: generateTags(r),
        },
      });
    }

    // Compute and upsert sensory scores from reviews
    const avg = (field) => loc.reviews.reduce((a, b) => a + b[field], 0) / loc.reviews.length;
    await prisma.sensoryScore.upsert({
      where: { locationId: location.id },
      update: {
        noiseScore: avg("noiseLevel"),
        lightingScore: avg("lightingLevel"),
        crowdScore: avg("crowdLevel"),
        comfortScore: avg("rating"),
        reviewCount: loc.reviews.length,
      },
      create: {
        locationId: location.id,
        noiseScore: avg("noiseLevel"),
        lightingScore: avg("lightingLevel"),
        crowdScore: avg("crowdLevel"),
        comfortScore: avg("rating"),
        reviewCount: loc.reviews.length,
      },
    });

    console.log(`  ✓ ${loc.name} — ${loc.reviews.length} reviews, comfort: ${avg("rating").toFixed(1)}`);
  }

  // 3. Seed locations WITHOUT reviews
  console.log("\nCreating 10 locations without reviews...");
  for (const loc of LOCATIONS_NO_REVIEWS) {
    const location = await prisma.location.upsert({
      where: { googlePlaceId: loc.googlePlaceId },
      update: { name: loc.name, category: loc.category, address: loc.address, description: loc.description, latitude: loc.latitude, longitude: loc.longitude },
      create: { googlePlaceId: loc.googlePlaceId, name: loc.name, category: loc.category, address: loc.address, description: loc.description, latitude: loc.latitude, longitude: loc.longitude },
    });

    await prisma.sensoryScore.upsert({
      where: { locationId: location.id },
      update: { noiseScore: loc.noiseScore, lightingScore: loc.lightingScore, crowdScore: loc.crowdScore, comfortScore: loc.comfortScore, reviewCount: 0 },
      create: { locationId: location.id, noiseScore: loc.noiseScore, lightingScore: loc.lightingScore, crowdScore: loc.crowdScore, comfortScore: loc.comfortScore, reviewCount: 0 },
    });

    console.log(`  ✓ ${loc.name} — pre-set scores, comfort: ${loc.comfortScore}`);
  }

  console.log("\n✅ Demo seed complete!");
  console.log(`   → ${LOCATIONS_WITH_REVIEWS.length} locations with reviews`);
  console.log(`   → ${LOCATIONS_NO_REVIEWS.length} locations with pre-set sensory scores`);
  console.log(`   → Demo user: ${DEMO_USER.email}`);
}

function generateTags(review) {
  const tags = [];
  if (review.noiseLevel <= 2) tags.push("very-quiet");
  else if (review.noiseLevel <= 4) tags.push("quiet");
  if (review.crowdLevel <= 2) tags.push("low-crowds");
  else if (review.crowdLevel <= 4) tags.push("moderate-crowds");
  if (review.lightingLevel <= 3) tags.push("soft-lighting");
  if (review.rating >= 8) tags.push("highly-recommended");
  return tags;
}

seed()
  .catch((e) => { console.error("Seed failed:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
