#!/usr/bin/env node
/**
 * Reseed BADMINTON DOUBLES (heats + SF + Bronze B1-B3 + Final F1-F3)
 * Courts 1-4 on Friday 22 Aug (20:00–22:00)
 * Courts 1-2 on Saturday 23 Aug
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import key from "./serviceAccountKey.json" assert { type: "json" };

initializeApp({ credential: cert(key), projectId: "hcibs-sportsfiesta" });
const db = getFirestore();

/* ─── 0 · wipe doubles ─── */
const gone = await db
    .collection("matches")
    .where("event_id", "==", "badminton_doubles")
    .get();
for (const d of gone.docs) await d.ref.delete();
console.log(`🗑️  deleted ${gone.size} old doubles docs`);

/* ─── 1 · placeholder teams ─── */
const ids = [
    ...Array.from({ length: 6 }, (_, i) => `DA${i + 1}`),
    ...Array.from({ length: 6 }, (_, i) => `DO${i + 1}`),
    "D1",
    "D2",
    "D3",
    "D4",
    "DF",
    "DB",
];
for (const id of ids)
    await db
        .doc(`teams/${id}`)
        .set({ name: id, event_id: "badminton_doubles" }, { merge: true });

/* ─── 2 · helper ─── */
async function put(docId, { a, b, court, time }) {
    await db.doc(`matches/${docId}`).set({
        event_id: "badminton_doubles",
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
const fri = new Date("2025-08-22T12:00:00Z"); // 20:00 SGT
const heats = [
    { s: 0, c: "Court 1", a: "DA1", b: "DA6" },
    { s: 0, c: "Court 2", a: "DA2", b: "DA5" },
    { s: 0, c: "Court 3", a: "DO1", b: "DO6" },
    { s: 0, c: "Court 4", a: "DO2", b: "DO5" },
    { s: 1, c: "Court 1", a: "DA3", b: "DA4" },
    { s: 1, c: "Court 3", a: "DO3", b: "DO4" },
    { s: 2, c: "Court 1", a: "DA1", b: "DA5" },
    { s: 2, c: "Court 2", a: "DA6", b: "DA3" },
    { s: 2, c: "Court 3", a: "DO1", b: "DO5" },
    { s: 2, c: "Court 4", a: "DO6", b: "DO3" },
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
for (const h of heats)
    await put(`D-Q${q++}`, {
        a: h.a,
        b: h.b,
        court: h.c,
        time: new Date(fri.getTime() + h.s * 10 * 60 * 1000),
    });

/* ─── 4 · Saturday bracket ─── */
const sat13 = new Date("2025-08-23T05:00:00Z"); // 13:00 SGT
await put("D-SF1", { a: "D1", b: "D4", court: "Court 1", time: sat13 });
await put("D-SF2", { a: "D2", b: "D3", court: "Court 2", time: sat13 });

const series14 = new Date("2025-08-23T06:00:00Z"); // 14:00 SGT
for (const tag of ["F", "B"]) {
    const court = tag === "F" ? "Court 1" : "Court 2";
    for (let i = 1; i <= 3; i++) {
        await put(`D-${tag}${i}`, {
            a: tag === "F" ? "DFW1" : "DBW1",
            b: tag === "F" ? "DFW2" : "DBW2",
            court: court,
            time: new Date(series14.getTime() + (i - 1) * 10 * 60 * 1000),
        });
    }
}

console.log("✅  doubles seeded (heats, SF, B1-3, F1-3)");
process.exit(0);
