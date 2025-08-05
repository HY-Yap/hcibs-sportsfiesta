/**
 * Seed ALL badminton matches (Fri heats + Sat semifinals / finals).
 * Run: node --experimental-modules scripts/seedBadmintonFull.mjs
 * Needs serviceAccountKey.json in ./scripts
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import svcAcc from "./serviceAccountKey.json" assert { type: "json" };

initializeApp({ credential: cert(svcAcc) });
const db = getFirestore();

/* ------------------------------------------------------------------ */
/* 1) placeholder teams                                               */
/* ------------------------------------------------------------------ */
const teamIds = [
    ...Array.from({ length: 6 }, (_, i) => `DA${i + 1}`),
    ...Array.from({ length: 6 }, (_, i) => `DO${i + 1}`),
    ...Array.from({ length: 5 }, (_, i) => `SD${i + 1}`),
    ...Array.from({ length: 5 }, (_, i) => `SB${i + 1}`),
    "D1",
    "D2",
    "D3",
    "D4",
    "S1",
    "S2",
    "S3",
    "S4",
    "DF",
    "SF",
];

for (const id of teamIds) {
    await db
        .doc(`teams/${id}`)
        .set({ name: id, event_id: "badminton" }, { merge: true });
}
console.log(`✅  ${teamIds.length} placeholder team docs merged/created`);

/* ------------------------------------------------------------------ */
/* 2) Friday heats (20:00–22:00 SGT, 10-min blocks)                   */
/* ------------------------------------------------------------------ */
const friBase = new Date("2025-08-22T12:00:00Z"); // 20:00 SGT = 12:00 UTC
const heats = [
    // slot, court, red, blue
    { s: 0, c: "Court 1", r: "DA1", b: "DA6" },
    { s: 0, c: "Court 2", r: "DA2", b: "DA5" },
    { s: 0, c: "Court 3", r: "DO1", b: "DO6" },
    { s: 0, c: "Court 4", r: "DO2", b: "DO5" },
    { s: 0, c: "Court 5", r: "SD1", b: "SD5" },
    { s: 0, c: "Court 6", r: "SB1", b: "SB2" },

    { s: 1, c: "Court 1", r: "DA3", b: "DA4" },
    { s: 1, c: "Court 3", r: "DO3", b: "DO4" },
    { s: 1, c: "Court 5", r: "SD2", b: "SD3" },
    { s: 1, c: "Court 6", r: "SB3", b: "SB4" },

    { s: 2, c: "Court 1", r: "DA1", b: "DA5" },
    { s: 2, c: "Court 2", r: "DA6", b: "DA3" },
    { s: 2, c: "Court 3", r: "DO1", b: "DO5" },
    { s: 2, c: "Court 4", r: "DO6", b: "DO3" },
    { s: 2, c: "Court 5", r: "SD1", b: "SD4" },
    { s: 2, c: "Court 6", r: "SB2", b: "SB5" },

    { s: 3, c: "Court 1", r: "DA2", b: "DA3" },
    { s: 3, c: "Court 3", r: "DO2", b: "DO3" },
    { s: 3, c: "Court 5", r: "SD2", b: "SD5" },
    { s: 3, c: "Court 6", r: "SB1", b: "SB4" },

    { s: 4, c: "Court 1", r: "DA1", b: "DA4" },
    { s: 4, c: "Court 2", r: "DA5", b: "DA3" },
    { s: 4, c: "Court 3", r: "DO1", b: "DO4" },
    { s: 4, c: "Court 4", r: "DO5", b: "DO3" },
    { s: 4, c: "Court 5", r: "SD1", b: "SD3" },
    { s: 4, c: "Court 6", r: "SB2", b: "SB3" },

    { s: 5, c: "Court 1", r: "DA6", b: "DA2" },
    { s: 5, c: "Court 3", r: "DO6", b: "DO2" },
    { s: 5, c: "Court 5", r: "SD5", b: "SD4" },
    { s: 5, c: "Court 6", r: "SB1", b: "SB5" },

    { s: 6, c: "Court 1", r: "DA1", b: "DA3" },
    { s: 6, c: "Court 2", r: "DA4", b: "DA2" },
    { s: 6, c: "Court 3", r: "DO1", b: "DO3" },
    { s: 6, c: "Court 4", r: "DO4", b: "DO2" },
    { s: 6, c: "Court 5", r: "SD1", b: "SD2" },
    { s: 6, c: "Court 6", r: "SB2", b: "SB4" },

    { s: 7, c: "Court 1", r: "DA5", b: "DA6" },
    { s: 7, c: "Court 3", r: "DO5", b: "DO6" },
    { s: 7, c: "Court 5", r: "SD3", b: "SD4" },
    { s: 7, c: "Court 6", r: "SB3", b: "SB5" },

    { s: 8, c: "Court 1", r: "DA1", b: "DA2" },
    { s: 8, c: "Court 2", r: "DA3", b: "DA6" },
    { s: 8, c: "Court 3", r: "DO1", b: "DO2" },
    { s: 8, c: "Court 4", r: "DO3", b: "DO6" },
    { s: 8, c: "Court 5", r: "SD4", b: "SD2" },
    { s: 8, c: "Court 6", r: "SB1", b: "SB3" },

    { s: 9, c: "Court 1", r: "DA4", b: "DA5" },
    { s: 9, c: "Court 3", r: "DO4", b: "DO5" },
    { s: 9, c: "Court 5", r: "SD3", b: "SD5" },
    { s: 9, c: "Court 6", r: "SB4", b: "SB5" },
];

/* ------------------------------------------------------------------ */
/* 3) Saturday schedule                                               */
/* ------------------------------------------------------------------ */
const satBase = new Date("2025-08-23T05:00:00Z"); // 13:00 SGT
const saturday = [
    // slot (# of 45-min blocks), court, id, red, blue
    { s: 0, c: "Court 1", id: "SF-D1", red: "D1", blue: "D4" },
    { s: 0, c: "Court 2", id: "SF-D2", red: "D2", blue: "D3" },
    { s: 0, c: "Court 3", id: "SF-S1", red: "S1", blue: "S4" },
    { s: 0, c: "Court 4", id: "SF-S2", red: "S2", blue: "S3" },

    { s: 2, c: "Court 1", id: "Final-Doubles", red: "DF", blue: "DF" },
    { s: 2, c: "Court 3", id: "Final-Singles", red: "SF", blue: "SF" },
];

/* ------------------------------------------------------------------ */
/* 4) uploader helper                                                 */
/* ------------------------------------------------------------------ */
let qNum = 1;

async function addMatch({ s, c, r, b, id }, base, prefix = "Q") {
    const matchId = id || `${prefix}${qNum++}`;
    await db.doc(`matches/${matchId}`).set({
        event_id: "badminton",
        competitor_a: { id: r },
        competitor_b: { id: b },
        score_a: null,
        score_b: null,
        status: "scheduled",
        venue: c,
        scheduled_at: new Date(base.getTime() + s * 10 * 60 * 1000),
    });
}

/* ------------- upload all heats ------------- */
for (const h of heats) await addMatch(h, friBase);

/* ------------- upload saturday -------------- */
for (const s of saturday) await addMatch(s, satBase, "");

/* -------------------------------------------- */
console.log("✅  All badminton matches seeded/merged");
process.exit(0);
