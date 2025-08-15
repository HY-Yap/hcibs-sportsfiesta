#!/usr/bin/env node
/**
 * seedBasketball3v3.mjs
 * -------------------------------------------------------------
 * Seeds Basketball 3v3 (ALL matches):
 *   • Qualifiers: 4 pools (A/B/C/D), 4 teams each, full round-robin
 *   • Elims: QF → SF → Bronze/Final (single game)
 *
 * Placeholders are used (A1..A4, B1..B4, C1..C4, D1..D4) so the website
 * shows a complete schedule; your reveal/advance functions will replace
 * them with real team IDs when the time comes.
 *
 * Times are from your sheet (SGT):
 *   Qual slots (12): 15:30, 15:38, 15:46, 15:54, 16:03, 16:11,
 *                    16:19, 16:27, 16:35, 16:43, 16:51, 16:59
 *   Elims: QF 17:20/17:30, SF 17:45, Bronze 18:00, Final 18:12
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const key = require("../serviceAccountKey.json");

initializeApp({ credential: cert(key), projectId: "hcibs-sportsfiesta" });
const db = getFirestore();

const EVENT_ID = "basketball3v3";
const PREFIX = "B";

/* ── wipe existing ── */
const old = await db
    .collection("matches")
    .where("event_id", "==", EVENT_ID)
    .get();
for (const d of old.docs) await d.ref.delete();
console.log(`🗑️  deleted ${old.size} old ${EVENT_ID} matches`);

/* ── teams (placeholders) ── */
const teamIds = [
    // pool placeholders (A–D, 4 teams each)
    ...["A", "B", "C", "D"].flatMap((p) =>
        Array.from({ length: 4 }, (_, i) => `${p}${i + 1}`)
    ),
    // nice-to-have placeholders shown in elims before seeding
    ...Array.from({ length: 8 }, (_, i) => `BW${i + 1}`), // QF seeds W1..W8
    "BQF1W",
    "BQF2W",
    "BQF3W",
    "BQF4W",
    "BSF1W",
    "BSF2W",
    "BSF1L",
    "BSF2L",
];
for (const id of teamIds) {
    await db
        .doc(`teams/${id}`)
        .set({ name: id, event_id: EVENT_ID }, { merge: true });
}

/* ── helpers ── */
const sgt = (h, m) => new Date(Date.UTC(2025, 7, 23, h - 8, m)); // 23 Aug 2025
async function put(id, { a, b, court, time, type, pool = null }) {
    const doc = {
        event_id: EVENT_ID,
        competitor_a: { id: a },
        competitor_b: { id: b },
        score_a: null,
        score_b: null,
        status: "scheduled",
        venue: court,
        scheduled_at: time,
        match_type: type, // "qualifier" | "qf" | "semi" | "bronze" | "final"
    };
    if (pool) doc.pool = pool;
    await db.doc(`matches/${id}`).set(doc);
}

/* ── QUALIFIERS (round-robin per pool) ──
   RR plan for each pool (teams 1..4):
     R1: (1 vs 2)  &  (3 vs 4)
     R2: (1 vs 3)  &  (2 vs 4)
     R3: (1 vs 4)  &  (2 vs 3)
   We run each pool in a 3-slot block; two courts run the 2 games concurrently.
*/
const QUAL_SLOTS_SGT = [
    [15, 30],
    [15, 38],
    [15, 46], // Pool A
    [15, 54],
    [16, 3],
    [16, 11], // Pool B
    [16, 19],
    [16, 27],
    [16, 35], // Pool C
    [16, 43],
    [16, 51],
    [16, 59], // Pool D
];

const pools = ["A", "B", "C", "D"];
let qn = 1;
for (let p = 0; p < pools.length; p++) {
    const P = pools[p];
    const base = p * 3;

    // Round 1
    await put(`${PREFIX}-Q${qn++}`, {
        a: `${P}1`,
        b: `${P}2`,
        court: "Court 1",
        time: sgt(...QUAL_SLOTS_SGT[base + 0]),
        type: "qualifier",
        pool: P,
    });
    await put(`${PREFIX}-Q${qn++}`, {
        a: `${P}3`,
        b: `${P}4`,
        court: "Court 2",
        time: sgt(...QUAL_SLOTS_SGT[base + 0]),
        type: "qualifier",
        pool: P,
    });

    // Round 2
    await put(`${PREFIX}-Q${qn++}`, {
        a: `${P}1`,
        b: `${P}3`,
        court: "Court 1",
        time: sgt(...QUAL_SLOTS_SGT[base + 1]),
        type: "qualifier",
        pool: P,
    });
    await put(`${PREFIX}-Q${qn++}`, {
        a: `${P}2`,
        b: `${P}4`,
        court: "Court 2",
        time: sgt(...QUAL_SLOTS_SGT[base + 1]),
        type: "qualifier",
        pool: P,
    });

    // Round 3
    await put(`${PREFIX}-Q${qn++}`, {
        a: `${P}1`,
        b: `${P}4`,
        court: "Court 1",
        time: sgt(...QUAL_SLOTS_SGT[base + 2]),
        type: "qualifier",
        pool: P,
    });
    await put(`${PREFIX}-Q${qn++}`, {
        a: `${P}2`,
        b: `${P}3`,
        court: "Court 2",
        time: sgt(...QUAL_SLOTS_SGT[base + 2]),
        type: "qualifier",
        pool: P,
    });
}

/* ── ELIMS ──
   QF seeding (after qualifiers using revealBasketballElims):
     QF1: W1 v W8  (Court 1, 17:20)
     QF2: W2 v W7  (Court 2, 17:20)
     QF3: W3 v W6  (Court 1, 17:30)
     QF4: W4 v W5  (Court 2, 17:30)
   SFs: 17:45   Bronze: 18:00 (Court 1)   Final: 18:12 (Court 1)
*/
await put(`${PREFIX}-QF1`, {
    a: "BW1",
    b: "BW8",
    court: "Court 1",
    time: sgt(17, 20),
    type: "qf",
});
await put(`${PREFIX}-QF2`, {
    a: "BW2",
    b: "BW7",
    court: "Court 2",
    time: sgt(17, 20),
    type: "qf",
});
await put(`${PREFIX}-QF3`, {
    a: "BW3",
    b: "BW6",
    court: "Court 1",
    time: sgt(17, 30),
    type: "qf",
});
await put(`${PREFIX}-QF4`, {
    a: "BW4",
    b: "BW5",
    court: "Court 2",
    time: sgt(17, 30),
    type: "qf",
});

await put(`${PREFIX}-SF1`, {
    a: "BQF1W",
    b: "BQF2W",
    court: "Court 1",
    time: sgt(17, 45),
    type: "semi",
});
await put(`${PREFIX}-SF2`, {
    a: "BQF3W",
    b: "BQF4W",
    court: "Court 2",
    time: sgt(17, 45),
    type: "semi",
});

await put(`${PREFIX}-B1`, {
    a: "BSF1L",
    b: "BSF2L",
    court: "Court 1",
    time: sgt(18, 0),
    type: "bronze",
});
await put(`${PREFIX}-F1`, {
    a: "BSF1W",
    b: "BSF2W",
    court: "Court 1",
    time: sgt(18, 12),
    type: "final",
});

console.log("✅  Basketball 3v3 seeded (qualifiers + elims)");
process.exit(0);
