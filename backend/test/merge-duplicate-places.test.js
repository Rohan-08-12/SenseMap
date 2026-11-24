// Run: node --experimental-test-module-mocks --test test/merge-duplicate-places.test.js  (no DB, nothing is touched)
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLocalDb, validatePairs, mergeDuplicatePlaces } from "../scripts/merge_duplicate_places.js";

test("refuses a non-local DATABASE_URL unless --allow-remote-db", () => {
    assert.throws(() => assertLocalDb("postgresql://u:p@db.example.supabase.co:5432/postgres"), /localhost/);
    assert.throws(() => assertLocalDb(undefined), /localhost/);
    assert.doesNotThrow(() => assertLocalDb("postgresql://test@127.0.0.1:55433/x"));
    assert.doesNotThrow(() => assertLocalDb("postgresql://test@localhost:5432/x"));
    assert.doesNotThrow(() => assertLocalDb("postgresql://u@db.example.supabase.co/x", { allowRemote: true }));
});

test("validatePairs: shape, same id, a remove used twice, an id that is keep in one pair and remove in another", () => {
    assert.deepEqual(validatePairs([{ keep: "a", remove: "b" }, { keep: "a", remove: "c" }]), []);   // several removes may share a keep
    assert.equal(validatePairs({}).length, 1);
    assert.match(validatePairs([{ keep: "a", remove: "a" }])[0].problem, /same id/);
    assert.match(validatePairs([{ keep: "a" }])[0].problem, /needs string/);
    assert.ok(validatePairs([{ keep: "a", remove: "c" }, { keep: "b", remove: "c" }]).length >= 2);
    assert.ok(validatePairs([{ keep: "a", remove: "b" }, { keep: "b", remove: "c" }]).length >= 1);
});

test("a malformed top-level input throws before touching the database", async () => {
    const prisma = new Proxy({}, { get() { throw new Error("database was touched"); } });
    await assert.rejects(() => mergeDuplicatePlaces(prisma, { not: "an array" }), /JSON array/);
});
