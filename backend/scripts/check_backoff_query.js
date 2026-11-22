/**
 * LOCAL-ONLY check of the incomplete-scores backoff, against a THROWAWAY Postgres. Not for production.
 *
 * It (1) refuses to run unless DATABASE_URL's host is localhost / 127.0.0.1, (2) applies the migrations
 * to that database, (3) inserts a few tagged Location + EnrichmentLog rows, (4) runs the REAL nightly
 * selection query (selectLocationsToEnrich) and the REAL GET /enrichment/stale route, and prints which
 * places are included or excluded versus what is expected, then (5) deletes only the rows it created.
 * It never calls Gemini or any other API.
 *
 * ---- 1. Start a throwaway local Postgres. The app's pool always uses SSL, so the server needs ssl=on.
 *
 *  Option A (uses the Postgres binaries on your machine; this is the setup I verified):
 *    PGBIN=/Library/PostgreSQL/17/bin            # adjust to your install
 *    D="$(mktemp -d)/pgdata"
 *    "$PGBIN/initdb" -D "$D" -U test --auth=trust -E UTF8
 *    openssl req -new -x509 -days 2 -nodes -subj /CN=localhost -out "$D/server.crt" -keyout "$D/server.key"
 *    chmod 600 "$D/server.key"; mkdir -p /tmp/pgsock55433
 *    "$PGBIN/pg_ctl" -D "$D" -o "-p 55433 -c ssl=on -c listen_addresses=127.0.0.1 -c unix_socket_directories=/tmp/pgsock55433" -l "$D/pg.log" start
 *    "$PGBIN/psql" -h 127.0.0.1 -p 55433 -U test postgres -c "create database backoff_test"
 *
 *  Option B (Docker; NOT verified, the Docker daemon was off when I wrote this): needs Docker running.
 *    docker run -d --name sensemap-pg-test -p 127.0.0.1:55433:5432 \
 *      -e POSTGRES_PASSWORD=test -e POSTGRES_DB=backoff_test postgres:17 \
 *      sh -c 'openssl req -new -x509 -days 2 -nodes -subj /CN=localhost -out /var/lib/postgresql/server.crt -keyout /var/lib/postgresql/server.key \
 *             && chown postgres:postgres /var/lib/postgresql/server.* && chmod 600 /var/lib/postgresql/server.key \
 *             && exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/var/lib/postgresql/server.crt -c ssl_key_file=/var/lib/postgresql/server.key'
 *
 * ---- 2. Run it (from backend/):
 *    export DATABASE_URL="postgresql://test@127.0.0.1:55433/backoff_test"       # Option A
 *    # Option B: export DATABASE_URL="postgresql://postgres:test@127.0.0.1:55433/backoff_test"
 *    node scripts/check_backoff_query.js
 *
 * ---- 3. Stop and delete it afterwards:
 *    "$PGBIN/pg_ctl" -D "$D" stop            # Option A
 *    docker rm -f sensemap-pg-test           # Option B
 *
 * Exit code 0 = every place was included/excluded as expected; 1 = a mismatch or an error.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---- guard: runs BEFORE dotenv, Prisma or anything else is loaded ---------------------------------
const rawUrl = process.env.DATABASE_URL;
let parsed;
try { parsed = new URL(rawUrl); } catch { /* handled below */ }
if (!parsed) {
    console.error("Refusing to run: set DATABASE_URL explicitly to a LOCAL throwaway database (see the header of this file).");
    process.exit(1);
}
const dbName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
console.log(`Target database: host=${parsed.hostname} port=${parsed.port || "5432"} database=${dbName}`);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) {
    console.error(`Refusing to run: host "${parsed.hostname}" is not localhost or 127.0.0.1. This script is for a throwaway local Postgres only.`);
    process.exit(1);
}
const SECRETS = [decodeURIComponent(parsed.password || ""), rawUrl];
const redactSecrets = (s) => SECRETS.filter((x) => x && x.length >= 4).reduce((acc, x) => acc.split(x).join("***"), String(s));
// Don't let Prisma's own `import "dotenv/config"` pick up anything that would override this URL: it
// never overrides an already-set variable, but make the intent explicit.
process.env.DATABASE_URL = rawUrl;

const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAG = "backoffcheck_";
const DAY = 24 * 3600 * 1000;
const daysAgo = (d) => new Date(Date.now() - d * DAY);

let prisma;
const created = { locations: [], logs: 0 };

async function main() {
    // ---- 1. migrations ------------------------------------------------------------------------------
    console.log("\nApplying migrations (prisma migrate deploy) to this database...");
    try {
        const out = execFileSync("npx", ["prisma", "migrate", "deploy"], { cwd: backendDir, env: { ...process.env, DATABASE_URL: rawUrl }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        console.log(redactSecrets(out).trim().split("\n").slice(-2).join("\n"));
    } catch (e) {
        console.error("migrate deploy failed:\n" + redactSecrets((e.stdout || "") + (e.stderr || "") || e.message).split("\n").slice(-12).join("\n"));
        process.exit(1);
    }

    // ---- 2. now it is safe to load the app code ---------------------------------------------------------
    ({ default: prisma } = await import("../src/lib/prisma.js"));
    const { selectLocationsToEnrich } = await import("../src/lib/enrichmentCron.js");
    const { idsInIncompleteBackoff } = await import("../src/lib/enrichmentBackoff.js");
    process.env.N8N_WEBHOOK_SECRET = "local-backoff-check";             // for the stale route below; not a real secret
    const { default: enrichmentRouter } = await import("../src/routes/enrichment.js");
    const { default: express } = await import("express");
    const http = await import("node:http");

    const preexisting = await prisma.location.count({ where: { googlePlaceId: { not: { startsWith: TAG } } } });
    if (preexisting > 0) console.log(`Note: ${preexisting} other Location row(s) exist in this database; they are ignored here (and never modified).`);

    // ---- 3. seed -----------------------------------------------------------------------------------------
    // Every place is stale (last enriched 10 days ago) unless noted, so without a backoff all would be selected.
    const cases = [
        { key: "A", name: "A: incomplete_scores 5 days ago",            enriched: daysAgo(10), log: { outcome: "incomplete_scores" }, logAge: 5,  expectNightly: false },
        { key: "B", name: "B: incomplete_scores 40 days ago",           enriched: daysAgo(10), log: { outcome: "incomplete_scores" }, logAge: 40, expectNightly: true  },
        { key: "C", name: "C: different outcome (low_confidence) 5d",   enriched: daysAgo(10), log: { outcome: "low_confidence" },    logAge: 5,  expectNightly: true  },
        { key: "D", name: "D: no log rows",                              enriched: daysAgo(10), log: null,                           logAge: 0,  expectNightly: true  },
        // extra controls
        { key: "E", name: "E: legacy score-history row (no outcome) 5d", enriched: daysAgo(10), log: { noise: 3, lighting: 2, crowd: 1, sources: ["google"] }, logAge: 5, expectNightly: true },
        { key: "F", name: "F: never enriched + incomplete_scores 5d",    enriched: null,        log: { outcome: "incomplete_scores" }, logAge: 5,  expectNightly: false },
        { key: "G", name: "G: enriched 1 day ago, no log (not stale)",   enriched: daysAgo(1),  log: null,                           logAge: 0,  expectNightly: false },
    ];
    for (const c of cases) {
        const loc = await prisma.location.create({ data: { googlePlaceId: TAG + c.key, name: c.name, latitude: 43.65, longitude: -79.38, lastEnrichedAt: c.enriched } });
        c.id = loc.id; created.locations.push(loc.id);
        if (c.log) {
            await prisma.enrichmentLog.create({ data: { locationId: loc.id, updatedAt: daysAgo(c.logAge), scores: c.log } });
            created.logs++;
        }
    }
    console.log(`\nSeeded ${cases.length} places and ${created.logs} log rows (tagged "${TAG}").`);

    // ---- 4. run the real queries -----------------------------------------------------------------------------
    const mine = new Set(created.locations);
    const nightly = new Set((await selectLocationsToEnrich({ force: false })).map((l) => l.id).filter((id) => mine.has(id)));
    const forced = new Set((await selectLocationsToEnrich({ force: true })).map((l) => l.id).filter((id) => mine.has(id)));
    const backoff = new Set((await idsInIncompleteBackoff(prisma)).filter((id) => mine.has(id)));

    const app = express(); app.use("/enrichment", enrichmentRouter);
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const staleRes = await fetch(`http://127.0.0.1:${server.address().port}/enrichment/stale`, { headers: { "x-n8n-secret": process.env.N8N_WEBHOOK_SECRET } });
    const staleBody = await staleRes.json();
    server.close();
    const stale = new Set((staleBody.locations ?? []).map((l) => l.id).filter((id) => mine.has(id)));

    // ---- 5. report ------------------------------------------------------------------------------------------
    const yn = (b) => (b ? "included" : "EXCLUDED");
    let failures = 0;
    const rows = cases.map((c) => {
        const actual = nightly.has(c.id), staleActual = stale.has(c.id);
        const ok = actual === c.expectNightly && staleActual === c.expectNightly && forced.has(c.id);
        if (!ok) failures++;
        return { place: c.name, "in backoff": backoff.has(c.id) ? "yes" : "no", "nightly": yn(actual), "n8n /stale": yn(staleActual), "forced run": yn(forced.has(c.id)), expected: yn(c.expectNightly), result: ok ? "PASS" : "FAIL" };
    });
    console.log("\nSelection results (forced runs must include everything; nightly and /stale must match 'expected'):");
    console.table(rows);
    console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
    process.exitCode = failures === 0 ? 0 : 1;
}

try {
    await main();
} catch (err) {
    console.error("check failed:", redactSecrets(err?.message ?? err));
    process.exitCode = 1;
} finally {
    if (prisma) {
        // remove only what this script created
        try {
            await prisma.enrichmentLog.deleteMany({ where: { locationId: { in: created.locations } } });
            await prisma.location.deleteMany({ where: { id: { in: created.locations } } });
            console.log("Cleaned up the rows this script created.");
        } catch (e) { console.error("cleanup failed:", redactSecrets(e.message)); }
        await prisma.$disconnect();
    }
}
