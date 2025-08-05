/**
 * Seed BADMINTON DOUBLES with doc-IDs  "D-Q1 …"  (no collision with singles)
 * Run:  node --experimental-modules scripts/seedBadmintonDoubles.mjs
 */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import key from "./serviceAccountKey.json" assert { type: "json" };

initializeApp({ credential: cert(key) });
const db = getFirestore();

/* 0 ▸ clear only doubles docs */
const gone = await db
    .collection("matches")
    .where("event_id", "==", "badminton_doubles")
    .get();
for (const d of gone.docs) await d.ref.delete();
console.log(`🗑️  removed ${gone.size} old doubles docs`);

/* 1 ▸ ensure teams exist (if not already) */
const teamIds = [
    ...Array.from({ length: 6 }, (_, i) => `DA${i + 1}`),
    ...Array.from({ length: 6 }, (_, i) => `DO${i + 1}`),
    "D1",
    "D2",
    "D3",
    "D4",
    "DF",
];
for (const id of teamIds) {
    await db
        .doc(`teams/${id}`)
        .set({ name: id, event_id: "badminton_doubles" }, { merge: true });
}

/* 2 ▸ Friday heats list (same as before) */
const friBase = new Date("2025-08-22T12:00:00Z"); // 20:00 SGT
const heats = [
    { s: 0, c: "Court 1", r: "DA1", b: "DA6" },
    { s: 0, c: "Court 2", r: "DA2", b: "DA5" },
    { s: 0, c: "Court 3", r: "DO1", b: "DO6" },
    { s: 0, c: "Court 4", r: "DO2", b: "DO5" },

    { s: 1, c: "Court 1", r: "DA3", b: "DA4" },
    { s: 1, c: "Court 3", r: "DO3", b: "DO4" },

    { s: 2, c: "Court 1", r: "DA1", b: "DA5" },
    { s: 2, c: "Court 2", r: "DA6", b: "DA3" },
    { s: 2, c: "Court 3", r: "DO1", b: "DO5" },
    { s: 2, c: "Court 4", r: "DO6", b: "DO3" },

    { s: 3, c: "Court 1", r: "DA2", b: "DA3" },
    { s: 3, c: "Court 3", r: "DO2", b: "DO3" },

    { s: 4, c: "Court 1", r: "DA1", b: "DA4" },
    { s: 4, c: "Court 2", r: "DA5", b: "DA3" },
    { s: 4, c: "Court 3", r: "DO1", b: "DO4" },
    { s: 4, c: "Court 4", r: "DO5", b: "DO3" },

    { s: 5, c: "Court 1", r: "DA6", b: "DA2" },
    { s: 5, c: "Court 3", r: "DO6", b: "DO2" },

    { s: 6, c: "Court 1", r: "DA1", b: "DA3" },
    { s: 6, c: "Court 2", r: "DA4", b: "DA2" },
    { s: 6, c: "Court 3", r: "DO1", b: "DO3" },
    { s: 6, c: "Court 4", r: "DO4", b: "DO2" },

    { s: 7, c: "Court 1", r: "DA5", b: "DA6" },
    { s: 7, c: "Court 3", r: "DO5", b: "DO6" },

    { s: 8, c: "Court 1", r: "DA1", b: "DA2" },
    { s: 8, c: "Court 2", r: "DA3", b: "DA6" },
    { s: 8, c: "Court 3", r: "DO1", b: "DO2" },
    { s: 8, c: "Court 4", r: "DO3", b: "DO6" },

    { s: 9, c: "Court 1", r: "DA4", b: "DA5" },
    { s: 9, c: "Court 3", r: "DO4", b: "DO5" },
];

/* 3 ▸ Saturday bracket */
const satBase = new Date("2025-08-23T05:00:00Z"); // 13:00 SGT
const saturday = [
    { s: 0, c: "Court 1", id: "D-SF1", r: "D1", b: "D4" }, // 13:00
    { s: 0, c: "Court 2", id: "D-SF2", r: "D2", b: "D3" }, // 13:00
    { s: 2, c: "Court 1", id: "D-Final", r: "DF", b: "DF" }, // 14:00
];

/* 4 ▸ uploader */
let q = 1;
async function put(match, base) {
    const docId = match.id || `D-Q${q++}`;
    await db.doc(`matches/${docId}`).set({
        event_id: "badminton_doubles",
        competitor_a: { id: match.r },
        competitor_b: { id: match.b },
        score_a: null,
        score_b: null,
        status: "scheduled",
        venue: match.c,
        scheduled_at: new Date(base.getTime() + match.s * 10 * 60 * 1000),
    });
}

/* write heats & bracket */
for (const h of heats) await put(h, friBase);
for (const m of saturday) await put(m, satBase);

console.log("✅  badminton_doubles reseeded with D-Q* IDs");
process.exit(0);
