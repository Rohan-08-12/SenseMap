/**
 * Tiny in-memory cache of PROMISES with a time-to-live, so identical requests made while the first is still running
 * share it (one paid Google call, not several) and repeats within the TTL cost nothing. Failed promises are not kept.
 * Per server instance only: a restart or a second instance starts empty.
 */
export function createTtlPromiseCache({ ttlMs = 60 * 60 * 1000, max = 500, now = Date.now } = {}) {
    const store = new Map(); // key -> { at, promise }
    return {
        get(key) {
            const hit = store.get(key);
            if (!hit) return undefined;
            if (now() - hit.at >= ttlMs) { store.delete(key); return undefined; }
            return hit.promise;
        },
        set(key, promise) {
            if (store.size >= max) store.delete(store.keys().next().value); // oldest first
            const entry = { at: now(), promise };
            store.set(key, entry);
            promise.catch(() => { if (store.get(key) === entry) store.delete(key); });
            return promise;
        },
        get size() { return store.size; },
        clear() { store.clear(); },
    };
}
