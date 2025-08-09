#!/usr/bin/env node
/**
 * Frisbee 5v5 seeder
 *  - Round robin (A/B/C), then Redemption, QF, SF, Bronze, Final, Bonus
 *  - Single game everywhere
 *
 * Run:  node scripts/seedFrisbee5v5.mjs
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import key from "./serviceAccountKey.json" assert { type: "json" };

initializeApp({ credential: cert(key), projectId: "hcibs-sportsfiesta" });
const db = getFirestore();

const EVENT_ID = "frisbee5v5";
const PREFIX = "F";

/* ── wipe existing ── */
const old = await db
    .collection("matches")
    .where("event_id", "==", EVENT_ID)
    .get();
for (const d of old.docs) await d.ref.delete();
console.log(`🗑️  removed ${old.size} old ${EVENT_ID} matches`);

/* ── placeholder teams ── */
const teamIds = [
    // pools
    ...["A", "B", "C"].flatMap((p) =>
        Array.from({ length: 4 }, (_, i) => `${p}${i + 1}`)
    ),
    // progression placeholders
    "FR1W",
    "FR2W", // redemption winners used in QF3/QF4
    "FSF1W",
    "FSF2W", // semi winners used in Final
    "FSF1L",
    "FSF2L", // semi losers used in Bronze
    "FCHAMP", // champion placeholder for bonus
    "IBP", // IBP Team for bonus match
];
for (const id of teamIds) {
    await db
        .doc(`teams/${id}`)
        .set(
            { name: id === "IBP" ? "IBP Team" : id, event_id: EVENT_ID },
            { merge: true }
        );
}

/* ── helpers ── */
const sgt = (h, m) => new Date(Date.UTC(2025, 7, 23, h - 8, m)); // 23 Aug 2025 SGT
async function put(id, { a, b, field, time, type, pool = null }) {
    const doc = {
        event_id: EVENT_ID,
        competitor_a: { id: a },
        competitor_b: { id: b },
        score_a: null,
        score_b: null,
        status: "scheduled",
        venue: field,
        scheduled_at: time,
        match_type: type, // "qualifier" | "redemption" | "qf" | "semi" | "bronze" | "final" | "bonus"
    };
    if (pool) doc.pool = pool;
    await db.doc(`matches/${id}`).set(doc);
}

/* ── ROUND ROBIN — from your sheet ── */
// Group A (T1..T4 → A1..A4)
await put(`${PREFIX}-Q1`, {
    a: "A1",
    b: "A2",
    field: "Field 1",
    time: sgt(7, 45),
    type: "qualifier",
    pool: "A",
});
await put(`${PREFIX}-Q2`, {
    a: "A3",
    b: "A4",
    field: "Field 2",
    time: sgt(7, 45),
    type: "qualifier",
    pool: "A",
});
await put(`${PREFIX}-Q3`, {
    a: "A1",
    b: "A3",
    field: "Field 1",
    time: sgt(8, 0o5),
    type: "qualifier",
    pool: "A",
});
await put(`${PREFIX}-Q4`, {
    a: "A2",
    b: "A4",
    field: "Field 2",
    time: sgt(8, 0o5),
    type: "qualifier",
    pool: "A",
});
await put(`${PREFIX}-Q5`, {
    a: "A1",
    b: "A4",
    field: "Field 1",
    time: sgt(8, 25),
    type: "qualifier",
    pool: "A",
});
await put(`${PREFIX}-Q6`, {
    a: "A2",
    b: "A3",
    field: "Field 2",
    time: sgt(8, 25),
    type: "qualifier",
    pool: "A",
});

// Group B (T5..T8 → B1..B4)
await put(`${PREFIX}-Q7`, {
    a: "B1",
    b: "B2",
    field: "Field 3",
    time: sgt(7, 45),
    type: "qualifier",
    pool: "B",
});
await put(`${PREFIX}-Q8`, {
    a: "B3",
    b: "B4",
    field: "Field 1",
    time: sgt(7, 55),
    type: "qualifier",
    pool: "B",
});
await put(`${PREFIX}-Q9`, {
    a: "B1",
    b: "B3",
    field: "Field 3",
    time: sgt(8, 0o5),
    type: "qualifier",
    pool: "B",
});
await put(`${PREFIX}-Q10`, {
    a: "B2",
    b: "B4",
    field: "Field 1",
    time: sgt(8, 15),
    type: "qualifier",
    pool: "B",
});
await put(`${PREFIX}-Q11`, {
    a: "B1",
    b: "B4",
    field: "Field 1",
    time: sgt(8, 35),
    type: "qualifier",
    pool: "B",
});
await put(`${PREFIX}-Q12`, {
    a: "B2",
    b: "B3",
    field: "Field 2",
    time: sgt(8, 35),
    type: "qualifier",
    pool: "B",
});

// Group C (T9..T12 → C1..C4)
await put(`${PREFIX}-Q13`, {
    a: "C1",
    b: "C2",
    field: "Field 2",
    time: sgt(7, 55),
    type: "qualifier",
    pool: "C",
});
await put(`${PREFIX}-Q14`, {
    a: "C3",
    b: "C4",
    field: "Field 3",
    time: sgt(7, 55),
    type: "qualifier",
    pool: "C",
});
await put(`${PREFIX}-Q15`, {
    a: "C1",
    b: "C3",
    field: "Field 2",
    time: sgt(8, 15),
    type: "qualifier",
    pool: "C",
});
await put(`${PREFIX}-Q16`, {
    a: "C2",
    b: "C4",
    field: "Field 3",
    time: sgt(8, 15),
    type: "qualifier",
    pool: "C",
});
await put(`${PREFIX}-Q17`, {
    a: "C1",
    b: "C4",
    field: "Field 3",
    time: sgt(8, 25),
    type: "qualifier",
    pool: "C",
});
await put(`${PREFIX}-Q18`, {
    a: "C2",
    b: "C3",
    field: "Field 3",
    time: sgt(8, 35),
    type: "qualifier",
    pool: "C",
});

/* ── REDEMPTION (participants revealed after qualifiers) ── */
await put(`${PREFIX}-R1`, {
    a: "A3",
    b: "B3",
    field: "Field 1",
    time: sgt(8, 55),
    type: "redemption",
}); // placeholders; will be overwritten
await put(`${PREFIX}-R2`, {
    a: "C3",
    b: "A4",
    field: "Field 2",
    time: sgt(8, 55),
    type: "redemption",
});

/* ── QUARTERS (QF3/QF4 wait on redemption winners) ── */
await put(`${PREFIX}-QF1`, {
    a: "A1",
    b: "B2",
    field: "Field 1",
    time: sgt(9, 0o5),
    type: "qf",
}); // A1 vs B2
await put(`${PREFIX}-QF2`, {
    a: "B1",
    b: "A2",
    field: "Field 2",
    time: sgt(9, 0o5),
    type: "qf",
}); // B1 vs A2
await put(`${PREFIX}-QF3`, {
    a: "C1",
    b: "FR1W",
    field: "Field 1",
    time: sgt(9, 15),
    type: "qf",
}); // C1 vs Redemption1 winner
await put(`${PREFIX}-QF4`, {
    a: "C2",
    b: "FR2W",
    field: "Field 2",
    time: sgt(9, 15),
    type: "qf",
}); // C2 vs Redemption2 winner

/* ── SEMIS / BRONZE / FINAL / BONUS ── */
await put(`${PREFIX}-SF1`, {
    a: "BQF1W",
    b: "BQF3W",
    field: "Field 1",
    time: sgt(9, 35),
    type: "semi",
});
await put(`${PREFIX}-SF2`, {
    a: "BQF2W",
    b: "BQF4W",
    field: "Field 2",
    time: sgt(9, 35),
    type: "semi",
});

await put(`${PREFIX}-B1`, {
    a: "FSF1L",
    b: "FSF2L",
    field: "Field 1",
    time: sgt(9, 55),
    type: "bronze",
});
await put(`${PREFIX}-F1`, {
    a: "FSF1W",
    b: "FSF2W",
    field: "Field 1",
    time: sgt(10, 0o5),
    type: "final",
});

await put(`${PREFIX}-BON1`, {
    a: "FCHAMP",
    b: "IBP",
    field: "Field 1",
    time: sgt(10, 25),
    type: "bonus",
});

console.log("✅  Frisbee 5v5 seeded");
process.exit(0);
