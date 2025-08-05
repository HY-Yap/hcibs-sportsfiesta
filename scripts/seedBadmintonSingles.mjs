/**
 * Reseed BADMINTON SINGLES  with doc-IDs  "S-Q1 …"
 * Run:  node --experimental-modules scripts/seedBadmintonSingles.mjs
 */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import key from "./serviceAccountKey.json" assert { type: "json" };

initializeApp({ credential: cert(key) });
const db = getFirestore();

/* 0 ▸ delete previous singles docs (doubles untouched) */
const gone = await db
    .collection("matches")
    .where("event_id", "==", "badminton_singles")
    .get();
for (const d of gone.docs) await d.ref.delete();
console.log(`🗑️  removed ${gone.size} old singles docs`);

/* 1 ▸ ensure placeholder teams exist */
const ids = [
    ...Array.from({ length: 5 }, (_, i) => `SD${i + 1}`),
    ...Array.from({ length: 5 }, (_, i) => `SB${i + 1}`),
    "S1",
    "S2",
    "S3",
    "S4",
    "SF",
];
for (const id of ids) {
    await db
        .doc(`teams/${id}`)
        .set({ name: id, event_id: "badminton_singles" }, { merge: true });
}

/* 2 ▸ Friday heats (both courts) */
const friBase = new Date("2025-08-22T12:00:00Z"); // 20:00 SGT
const heats = [
    { s: 0, c: "Court 5", r: "SD1", b: "SD5" },
    { s: 0, c: "Court 6", r: "SB1", b: "SB2" },
    { s: 1, c: "Court 5", r: "SD2", b: "SD3" },
    { s: 1, c: "Court 6", r: "SB3", b: "SB4" },
    { s: 2, c: "Court 5", r: "SD1", b: "SD4" },
    { s: 2, c: "Court 6", r: "SB2", b: "SB5" },
    { s: 3, c: "Court 5", r: "SD2", b: "SD5" },
    { s: 3, c: "Court 6", r: "SB1", b: "SB4" },
    { s: 4, c: "Court 5", r: "SD1", b: "SD3" },
    { s: 4, c: "Court 6", r: "SB2", b: "SB3" },
    { s: 5, c: "Court 5", r: "SD5", b: "SD4" },
    { s: 5, c: "Court 6", r: "SB1", b: "SB5" },
    { s: 6, c: "Court 5", r: "SD1", b: "SD2" },
    { s: 6, c: "Court 6", r: "SB2", b: "SB4" },
    { s: 7, c: "Court 5", r: "SD3", b: "SD4" },
    { s: 7, c: "Court 6", r: "SB3", b: "SB5" },
    { s: 8, c: "Court 5", r: "SD4", b: "SD2" },
    { s: 8, c: "Court 6", r: "SB1", b: "SB3" },
    { s: 9, c: "Court 5", r: "SD3", b: "SD5" },
    { s: 9, c: "Court 6", r: "SB4", b: "SB5" },
];

/* 3 ▸ Saturday semifinals + final */
const satBase = new Date("2025-08-23T05:00:00Z"); // 13:00 SGT
const saturday = [
    { s: 0, c: "Court 3", id: "S-SF-1", r: "S1", b: "S4" }, // 13:00
    { s: 0, c: "Court 4", id: "S-SF-2", r: "S2", b: "S3" }, // 13:00
    { s: 2, c: "Court 3", id: "S-Final", r: "SF", b: "SF" }, // 13:20
];

/* 4 ▸ upload helper */
let q = 1;
async function put(match, base) {
    const docId = match.id || `S-Q${q++}`; // <-- singles namespace
    await db.doc(`matches/${docId}`).set({
        event_id: "badminton_singles",
        competitor_a: { id: match.r },
        competitor_b: { id: match.b },
        score_a: null,
        score_b: null,
        status: "scheduled",
        venue: match.c,
        scheduled_at: new Date(base.getTime() + match.s * 10 * 60 * 1000),
    });
}

/* upload */
for (const h of heats) await put(h, friBase);
for (const m of saturday) await put(m, satBase);

console.log("✅  badminton_singles reseeded with S-Q* IDs");
process.exit(0);
