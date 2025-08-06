#!/usr/bin/env node
/**
 * Reseed BADMINTON SINGLES (heats + SF + Bronze B1-B3 + Final F1-F3)
 * Court 5 / Court 6 on Friday 22 Aug (20:00 SGT onward)
 * Court 3 / Court 4 on Saturday 23 Aug
 *
 *   S-Q*   = qualifier
 *   S-SF1/2= semi-finals          (13:00 SGT)
 *   S-B1-3 = bronze series  best-of-3 (13:40 / 13:50 / 14:00 SGT)
 *   S-F1-3 = final  series  best-of-3 (same times, other court)
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import key from "./serviceAccountKey.json" assert { type: "json" };

initializeApp({ credential: cert(key), projectId: "hcibs-sportsfiesta" });
const db = getFirestore();

/* ─── 0 · wipe old singles ─── */
const gone = await db
    .collection("matches")
    .where("event_id", "==", "badminton_singles")
    .get();
for (const d of gone.docs) await d.ref.delete();
console.log(`🗑️  deleted ${gone.size} old singles docs`);

/* ─── 1 · placeholder teams ─── */
const ids = [
    ...Array.from({ length: 5 }, (_, i) => `SD${i + 1}`), // Draw A
    ...Array.from({ length: 5 }, (_, i) => `SB${i + 1}`), // Draw B
    "S1",
    "S2",
    "S3",
    "S4",
    "SF",
    "SB",
];
for (const id of ids)
    await db
        .doc(`teams/${id}`)
        .set({ name: id, event_id: "badminton_singles" }, { merge: true });

/* ─── 2 · helper ─── */
async function put(docId, { a, b, court, time }) {
    await db.doc(`matches/${docId}`).set({
        event_id: "badminton_singles",
        competitor_a: { id: a },
        competitor_b: { id: b },
        score_a: null,
        score_b: null,
        status: "scheduled",
        venue: court,
        scheduled_at: time,
    });
}

/* ─── 3 · Friday heats ─── */
const friBase = new Date("2025-08-22T12:00:00Z"); // 20:00 SGT
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
        time: new Date(friBase.getTime() + h.s * 10 * 60 * 1000),
    });

/* ─── 4 · Saturday bracket ─── */
const sat13 = new Date("2025-08-23T05:00:00Z"); // 13:00 SGT
await put("S-SF1", { a: "S1", b: "S4", court: "Court 3", time: sat13 });
await put("S-SF2", { a: "S2", b: "S3", court: "Court 4", time: sat13 });

const seriesStart = new Date("2025-08-23T05:40:00Z"); // 13:40
for (const tag of ["F", "B"]) {
    const court = tag === "F" ? "Court 3" : "Court 4";
    for (let i = 1; i <= 3; i++) {
        await put(`S-${tag}${i}`, {
            a: tag === "F" ? "SFW1" : "SBW1",
            b: tag === "F" ? "SFW2" : "SBW2",
            court: court,
            time: new Date(seriesStart.getTime() + (i - 1) * 10 * 60 * 1000),
        });
    }
}

console.log("✅  singles seeded (heats, SF, B1-3, F1-3)");
process.exit(0);
