#!/usr/bin/env node
/**
 * Badminton Singles seeder
 *  – Heats Court 5/6  (SD… = Pool A, SB… = Pool B)
 *  – Saturday BO3 semis / bronze / final
 *
 * Run:  node scripts/seedBadmintonSingles.mjs
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const key = require("../serviceAccountKey.json");

initializeApp({ credential: cert(key), projectId: "hcibs-sportsfiesta" });
const db = getFirestore();

/* wipe old singles docs */
const gone = await db
    .collection("matches")
    .where("event_id", "==", "badminton_singles")
    .get();
for (const d of gone.docs) await d.ref.delete();
console.log(`🗑️  removed ${gone.size} old singles docs`);

/* placeholder teams */
const ids = [
    ...Array.from({ length: 5 }, (_, i) => `SD${i + 1}`),
    ...Array.from({ length: 5 }, (_, i) => `SB${i + 1}`),
    "S1",
    "S2",
    "S3",
    "S4",
    "SFW1",
    "SFW2",
    "SBW1",
    "SBW2",
];
for (const id of ids)
    await db
        .doc(`teams/${id}`)
        .set({ name: id, event_id: "badminton_singles" }, { merge: true });

/* helper */
async function put(id, { a, b, court, time, pool = null, type }) {
    const match = {
        event_id: "badminton_singles",
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

/* Friday heats (20:00-22:00 SGT) */
const fri = new Date("2025-08-22T12:00:00Z");
const heats = [
    { s: 0, c: "Court 5", a: "SD1", b: "SD5" },
    { s: 0, c: "Court 6", a: "SB1", b: "SB2" },
    { s: 1, c: "Court 5", a: "SD2", b: "SD3" },
    { s: 1, c: "Court 6", a: "SB3", b: "SB4" },
    { s: 2, c: "Court 5", a: "SD1", b: "SD4" },
    { s: 2, c: "Court 6", a: "SB2", b: "SB5" },
    { s: 3, c: "Court 5", a: "SD2", b: "SD5" },
    { s: 3, c: "Court 6", a: "SB1", b: "SB4" },
    { s: 4, c: "Court 5", a: "SD1", b: "SD3" },
    { s: 4, c: "Court 6", a: "SB2", b: "SB3" },
    { s: 5, c: "Court 5", a: "SD5", b: "SD4" },
    { s: 5, c: "Court 6", a: "SB1", b: "SB5" },
    { s: 6, c: "Court 5", a: "SD1", b: "SD2" },
    { s: 6, c: "Court 6", a: "SB2", b: "SB4" },
    { s: 7, c: "Court 5", a: "SD3", b: "SD4" },
    { s: 7, c: "Court 6", a: "SB3", b: "SB5" },
    { s: 8, c: "Court 5", a: "SD4", b: "SD2" },
    { s: 8, c: "Court 6", a: "SB1", b: "SB3" },
    { s: 9, c: "Court 5", a: "SD3", b: "SD5" },
    { s: 9, c: "Court 6", a: "SB4", b: "SB5" },
];
let q = 1;
for (const h of heats)
    await put(`S-Q${q++}`, {
        a: h.a,
        b: h.b,
        court: h.c,
        time: new Date(fri.getTime() + h.s * 10 * 60 * 1000),
        pool: h.a.startsWith("SD") ? "A" : "B",
        type: "qualifier",
    });

/* Saturday 13:00 SGT – BO3 semis */
const sat1300 = new Date("2025-08-23T05:00:00Z");
for (const br of [
    { id: "S-SF1", court: "Court 3", A: "S1", B: "S4" },
    { id: "S-SF2", court: "Court 4", A: "S2", B: "S3" },
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

/* Saturday 13:40 SGT – Bronze & Final series */
const sat1340 = new Date("2025-08-23T05:40:00Z");
for (const tag of ["F", "B"]) {
    const court = tag === "F" ? "Court 3" : "Court 4";
    const A = tag === "F" ? "SFW1" : "SBW1";
    const B = tag === "F" ? "SFW2" : "SBW2";
    const type = tag === "F" ? "final" : "bronze";

    for (let g = 1; g <= 3; g++) {
        await put(`S-${tag}${g}`, {
            a: A,
            b: B,
            court,
            time: new Date(sat1340.getTime() + (g - 1) * 15 * 60 * 1000),
            type,
        });
    }
}

console.log("✅  Singles seeded (heats + BO3 semis + bronze/final)");
process.exit(0);
