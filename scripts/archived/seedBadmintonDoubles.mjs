#!/usr/bin/env node
/**
 * Badminton Doubles seeder
 *  – Friday heats (Courts 1-4) with pool tags  ▸ pool "A" = DA…   pool "B" = DO…
 *  – Saturday SF best-of-3 + Bronze/Final series
 *
 * Run:  node scripts/seedBadmintonDoubles.mjs
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const key = require("../serviceAccountKey.json");

initializeApp({ credential: cert(key), projectId: "hcibs-sportsfiesta" });
const db = getFirestore();

/* ── wipe previous doubles docs ── */
const gone = await db
    .collection("matches")
    .where("event_id", "==", "badminton_doubles")
    .get();
for (const d of gone.docs) await d.ref.delete();
console.log(`🗑️  removed ${gone.size} old doubles docs`);

/* ── ensure placeholder teams ── */
const ids = [
    ...Array.from({ length: 6 }, (_, i) => `DA${i + 1}`),
    ...Array.from({ length: 6 }, (_, i) => `DO${i + 1}`),
    "D1",
    "D2",
    "D3",
    "D4",
    "DFW1",
    "DFW2",
    "DBW1",
    "DBW2",
];
for (const id of ids)
    await db
        .doc(`teams/${id}`)
        .set({ name: id, event_id: "badminton_doubles" }, { merge: true });

/* helper */
async function put(id, { a, b, court, time, pool = null, type }) {
    const match = {
        event_id: "badminton_doubles",
        competitor_a: { id: a },
        competitor_b: { id: b },
        score_a: null,
        score_b: null,
        status: "scheduled",
        venue: court,
        scheduled_at: time,
        match_type: type,
    };

    // Only add pool if it's provided (qualifiers only)
    if (pool) {
        match.pool = pool;
    }

    await db.doc(`matches/${id}`).set(match);
}

/* ── Friday heats (20:00–22:00 SGT) ── */
const fri = new Date("2025-08-22T12:00:00Z"); // 20:00 SGT
const heats = [
    // s = slot 0-…  each +=10 min
    { s: 0, c: "Court 1", a: "DA1", b: "DA6" },
    { s: 0, c: "Court 2", a: "DA2", b: "DA5" },
    { s: 0, c: "Court 3", a: "DO1", b: "DO6" },
    { s: 0, c: "Court 4", a: "DO2", b: "DO5" },
    { s: 1, c: "Court 1", a: "DA3", b: "DA4" },
    { s: 1, c: "Court 3", a: "DO3", b: "DO4" },
    { s: 2, c: "Court 1", a: "DA1", b: "DA5" },
    { s: 2, c: "Court 2", a: "DA6", b: "DA4" },
    { s: 2, c: "Court 3", a: "DO1", b: "DO5" },
    { s: 2, c: "Court 4", a: "DO6", b: "DO4" },
    { s: 3, c: "Court 1", a: "DA2", b: "DA3" },
    { s: 3, c: "Court 3", a: "DO2", b: "DO3" },
    { s: 4, c: "Court 1", a: "DA1", b: "DA4" },
    { s: 4, c: "Court 2", a: "DA5", b: "DA3" },
    { s: 4, c: "Court 3", a: "DO1", b: "DO4" },
    { s: 4, c: "Court 4", a: "DO5", b: "DO3" },
    { s: 5, c: "Court 1", a: "DA6", b: "DA2" },
    { s: 5, c: "Court 3", a: "DO6", b: "DO2" },
    { s: 6, c: "Court 1", a: "DA1", b: "DA3" },
    { s: 6, c: "Court 2", a: "DA4", b: "DA2" },
    { s: 6, c: "Court 3", a: "DO1", b: "DO3" },
    { s: 6, c: "Court 4", a: "DO4", b: "DO2" },
    { s: 7, c: "Court 1", a: "DA5", b: "DA6" },
    { s: 7, c: "Court 3", a: "DO5", b: "DO6" },
    { s: 8, c: "Court 1", a: "DA1", b: "DA2" },
    { s: 8, c: "Court 2", a: "DA3", b: "DA6" },
    { s: 8, c: "Court 3", a: "DO1", b: "DO2" },
    { s: 8, c: "Court 4", a: "DO3", b: "DO6" },
    { s: 9, c: "Court 1", a: "DA4", b: "DA5" },
    { s: 9, c: "Court 3", a: "DO4", b: "DO5" },
];

let q = 1;
for (const h of heats) {
    await put(`D-Q${q++}`, {
        a: h.a,
        b: h.b,
        court: h.c,
        time: new Date(fri.getTime() + h.s * 10 * 60 * 1000),
        pool: h.a.startsWith("DA") ? "A" : "B",
        type: "qualifier",
    });
}

/* ── Saturday 13:00 SGT – best-of-3 Semi-finals ── */
const sat1300 = new Date("2025-08-23T05:00:00Z"); // 13:00 SGT
for (const br of [
    { id: "D-SF1", court: "Court 1", A: "D1", B: "D4" },
    { id: "D-SF2", court: "Court 2", A: "D2", B: "D3" },
]) {
    for (let g = 1; g <= 3; g++) {
        await put(`${br.id}-${g}`, {
            a: br.A,
            b: br.B,
            court: br.court,
            time: new Date(sat1300.getTime() + (g - 1) * 15 * 60 * 1000),
            type: "semi",
        });
    }
}

/* ── Saturday 14:00 SGT – Bronze & Final series ── */
const sat1400 = new Date("2025-08-23T06:00:00Z"); // 14:00 SGT
for (const tag of ["F", "B"]) {
    const court = tag === "F" ? "Court 1" : "Court 2";
    const A = tag === "F" ? "DFW1" : "DBW1";
    const B = tag === "F" ? "DFW2" : "DBW2";
    const type = tag === "F" ? "final" : "bronze";

    for (let g = 1; g <= 3; g++) {
        await put(`D-${tag}${g}`, {
            a: A,
            b: B,
            court,
            time: new Date(sat1400.getTime() + (g - 1) * 15 * 60 * 1000),
            type,
        });
    }
}

console.log("✅  Doubles seeded (heats + BO3 semis + bronze/final)");
process.exit(0);
