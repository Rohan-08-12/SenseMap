// In-memory stand-in for the parts of prisma.location that findExistingPlace / discoverResolve use. No DB.
export function fakeLocationDb(initial = []) {
    const rows = initial.map((r) => ({ category: null, address: null, ...r }));
    const log = { creates: [], updates: [], findUnique: 0, findMany: 0 };
    const withScores = (r, args) => (r && args?.include?.sensoryScores ? { ...r, sensoryScores: r.sensoryScores ?? null } : r && { ...r });
    let n = 0;
    const location = {
        findUnique: async (args) => {
            log.findUnique++;
            const w = args.where;
            const r = rows.find((x) => (w.id ? x.id === w.id : x.googlePlaceId === w.googlePlaceId));
            return withScores(r, args) ?? null;
        },
        findMany: async (args = {}) => {
            log.findMany++;
            const w = args.where ?? {};
            return rows
                .filter((r) => (!w.latitude || (r.latitude >= w.latitude.gte && r.latitude <= w.latitude.lte)) &&
                               (!w.longitude || (r.longitude >= w.longitude.gte && r.longitude <= w.longitude.lte)) &&
                               (!w.id?.in || w.id.in.includes(r.id)))
                .map((r) => withScores(r, args));
        },
        create: async ({ data }) => {
            if (data.googlePlaceId && rows.some((r) => r.googlePlaceId === data.googlePlaceId)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
            const row = { id: `new${++n}`, ...data };
            rows.push(row); log.creates.push(row);
            return { ...row };
        },
        updateMany: async ({ where, data }) => {
            const hit = rows.filter((r) => r.id === where.id && (!("googlePlaceId" in where) || (r.googlePlaceId ?? null) === where.googlePlaceId));
            hit.forEach((r) => { Object.assign(r, data); log.updates.push({ id: r.id, data }); });
            return { count: hit.length };
        },
    };
    return { prisma: { location }, rows, log };
}
