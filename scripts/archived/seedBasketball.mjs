#!/usr/bin/env node
/**
 * seedBasketball3v3.mjs
 * -------------------------------------------------------------
 * Seeds Basketball 3v3 (ALL matches):
 *   • Qualifiers: 2 pools (A/B), 5 teams each, full round-robin
 *   • Elims: SF → Bronze/Final (single game)
 *
 * Placeholders are used (A1..A5, B1..B5) so the website
 * shows a complete schedule; your reveal/advance functions will replace
 * them with real team IDs when the time comes.
 *
 * Times are from your updated schedule (SGT):
 *   Qual slots: 07:30, 07:40, 07:50, 08:00, 08:10, 08:20, 08:30, 08:40, 08:50, 09:00
 *   Elims: SF 09:20, Bronze 09:45, Final 10:10
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
    // pool placeholders (A–B, 5 teams each) - only the actual teams
    ...["A", "B"].flatMap((p) =>
        Array.from({ length: 5 }, (_, i) => `${p}${i + 1}`)
    ),
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
        match_type: type, // "qualifier" | "semi" | "bronze" | "final"
    };
    if (pool) doc.pool = pool;
    await db.doc(`matches/${id}`).set(doc);
}

/* ── QUALIFIERS (round-robin per pool) ──
   RR plan for each pool (teams 1..5):
     R1: (1 vs 2) & (3 vs 5)
     R2: (1 vs 3) & (2 vs 4) 
     R3: (1 vs 4) & (3 vs 5)
     R4: (1 vs 5) & (2 vs 3)
     R5: (2 vs 5) & (4 vs 5)
   We run each pool with two courts concurrently.
*/
const QUAL_TIMES_SGT = [
    [7, 30], [7, 40], [7, 50], [8, 0], [8, 10],
    [8, 20], [8, 30], [8, 40], [8, 50], [9, 0]
];

// Pool A matches (A1-A5 round robin)
await put(`B-Q1`, { a: "A3", b: "A5", court: "Court 1", time: sgt(7, 30), type: "qualifier", pool: "A" });
await put(`B-Q3`, { a: "A1", b: "A2", court: "Court 1", time: sgt(7, 40), type: "qualifier", pool: "A" });
await put(`B-Q5`, { a: "A3", b: "A4", court: "Court 1", time: sgt(7, 50), type: "qualifier", pool: "A" });
await put(`B-Q7`, { a: "A1", b: "A5", court: "Court 1", time: sgt(8, 0), type: "qualifier", pool: "A" });
await put(`B-Q10`, { a: "A2", b: "A4", court: "Court 1", time: sgt(8, 10), type: "qualifier", pool: "A" });
await put(`B-Q11`, { a: "A1", b: "A3", court: "Court 1", time: sgt(8, 20), type: "qualifier", pool: "A" });
await put(`B-Q13`, { a: "A4", b: "A5", court: "Court 1", time: sgt(8, 30), type: "qualifier", pool: "A" });
await put(`B-Q15`, { a: "A2", b: "A3", court: "Court 1", time: sgt(8, 40), type: "qualifier", pool: "A" });
await put(`B-Q17`, { a: "A1", b: "A4", court: "Court 1", time: sgt(8, 50), type: "qualifier", pool: "A" });
await put(`B-Q19`, { a: "A2", b: "A5", court: "Court 1", time: sgt(9, 0), type: "qualifier", pool: "A" });

// Pool B matches (B1-B5 round robin)
await put(`B-Q2`, { a: "B3", b: "B5", court: "Court 2", time: sgt(7, 30), type: "qualifier", pool: "B" });
await put(`B-Q4`, { a: "B1", b: "B2", court: "Court 2", time: sgt(7, 40), type: "qualifier", pool: "B" });
await put(`B-Q6`, { a: "B3", b: "B4", court: "Court 2", time: sgt(7, 50), type: "qualifier", pool: "B" });
await put(`B-Q8`, { a: "B1", b: "B5", court: "Court 2", time: sgt(8, 0), type: "qualifier", pool: "B" });
await put(`B-Q9`, { a: "B2", b: "B4", court: "Court 2", time: sgt(8, 10), type: "qualifier", pool: "B" });
await put(`B-Q12`, { a: "B1", b: "B3", court: "Court 2", time: sgt(8, 20), type: "qualifier", pool: "B" });
await put(`B-Q14`, { a: "B4", b: "B5", court: "Court 2", time: sgt(8, 30), type: "qualifier", pool: "B" });
await put(`B-Q16`, { a: "B2", b: "B3", court: "Court 2", time: sgt(8, 40), type: "qualifier", pool: "B" });
await put(`B-Q18`, { a: "B1", b: "B4", court: "Court 2", time: sgt(8, 50), type: "qualifier", pool: "B" });
await put(`B-Q20`, { a: "B2", b: "B5", court: "Court 2", time: sgt(9, 0), type: "qualifier", pool: "B" });

/* ── ELIMS ──
   After qualifiers, direct to semifinals:
     SF1: Pool A winner vs Pool B runner-up (Court 1, 09:20)
     SF2: Pool B winner vs Pool A runner-up (Court 2, 09:20)
   Bronze: 09:45 (Court 1)   Final: 10:10 (Court 1)
*/

await put(`B-SF1`, {
    a: "BQF1W",
    b: "BQF2W",
    court: "Court 1",
    time: sgt(9, 20),
    type: "semi",
});
await put(`B-SF2`, {
    a: "BQF3W", 
    b: "BQF4W",
    court: "Court 2", 
    time: sgt(9, 20),
    type: "semi",
});

await put(`B-B1`, {
    a: "BSF1L",
    b: "BSF2L",
    court: "Court 1",
    time: sgt(9, 45),
    type: "bronze",
});
await put(`B-F1`, {
    a: "BSF1W",
    b: "BSF2W",
    court: "Court 1",
    time: sgt(10, 10),
    type: "final",
});

console.log("✅  Basketball 3v3 seeded (qualifiers + elims)");
process.exit(0);
