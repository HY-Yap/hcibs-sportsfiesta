#!/usr/bin/env node
/**
 * seedAllMatches.mjs
 * ------------------
 * Seeds ALL tournament matches for Sports Fiesta:
 *   • Basketball 3v3 (pools + single elims)
 *   • Frisbee 5v5 (pools + redemption + single elims + bonus)
 *   • Badminton Singles (pools + BO3 series)
 *   • Badminton Doubles (pools + BO3 series)
 *
 * Run: node scripts/seedAllMatches.mjs
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import key from "../serviceAccountKey.json" assert { type: "json" };

initializeApp({ credential: cert(key), projectId: "hcibs-sportsfiesta" });
const db = getFirestore();

/* ══════════════════════════════════════════════════════════════════════════
   SHARED UTILITIES
   ══════════════════════════════════════════════════════════════════════════ */

const sgt = (h, m) => new Date(Date.UTC(2025, 7, 23, h - 8, m)); // 23 Aug 2025 SGT
const fri = new Date("2025-08-22T12:00:00Z"); // 20:00 SGT Friday

async function wipeEvent(eventId) {
    const old = await db
        .collection("matches")
        .where("event_id", "==", eventId)
        .get();
    for (const d of old.docs) await d.ref.delete();
    console.log(`🗑️  removed ${old.size} old ${eventId} matches`);
}

async function createTeams(teamIds, eventId) {
    for (const id of teamIds) {
        await db
            .doc(`teams/${id}`)
            .set(
                { name: id === "IBP" ? "IBP Team" : id, event_id: eventId },
                { merge: true }
            );
    }
}

async function putMatch(id, { a, b, venue, time, type, pool = null, eventId }) {
    const match = {
        event_id: eventId,
        competitor_a: { id: a },
        competitor_b: { id: b },
        score_a: null,
        score_b: null,
        status: "scheduled",
        venue,
        scheduled_at: time,
        match_type: type,
    };
    if (pool) match.pool = pool;
    await db.doc(`matches/${id}`).set(match);
}

/* ══════════════════════════════════════════════════════════════════════════
   BADMINTON SINGLES
   ══════════════════════════════════════════════════════════════════════════ */

async function seedBadmintonSingles() {
    console.log("🏸 Seeding Badminton Singles...");

    await wipeEvent("badminton_singles");

    // Create placeholder teams
    const singlesTeams = [
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
    await createTeams(singlesTeams, "badminton_singles");

    // Friday heats (20:00-22:00 SGT)
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
    for (const h of heats) {
        await putMatch(`S-Q${q++}`, {
            a: h.a,
            b: h.b,
            venue: h.c,
            time: new Date(fri.getTime() + h.s * 10 * 60 * 1000),
            pool: h.a.startsWith("SD") ? "A" : "B",
            type: "qualifier",
            eventId: "badminton_singles",
        });
    }

    // Saturday BO3 series
    const sat1300 = new Date("2025-08-23T05:00:00Z"); // 13:00 SGT
    const sat1340 = new Date("2025-08-23T05:40:00Z"); // 13:40 SGT

    // Semifinals
    for (const br of [
        { id: "S-SF1", court: "Court 3", A: "S1", B: "S4" },
        { id: "S-SF2", court: "Court 4", A: "S2", B: "S3" },
    ]) {
        for (let g = 1; g <= 3; g++) {
            await putMatch(`${br.id}-${g}`, {
                a: br.A,
                b: br.B,
                venue: br.court,
                time: new Date(sat1300.getTime() + (g - 1) * 15 * 60 * 1000),
                type: "semi",
                eventId: "badminton_singles",
            });
        }
    }

    // Bronze & Final series
    for (const tag of ["F", "B"]) {
        const court = tag === "F" ? "Court 3" : "Court 4";
        const A = tag === "F" ? "SFW1" : "SBW1";
        const B = tag === "F" ? "SFW2" : "SBW2";
        const type = tag === "F" ? "final" : "bronze";

        for (let g = 1; g <= 3; g++) {
            await putMatch(`S-${tag}${g}`, {
                a: A,
                b: B,
                venue: court,
                time: new Date(sat1340.getTime() + (g - 1) * 15 * 60 * 1000),
                type,
                eventId: "badminton_singles",
            });
        }
    }

    console.log("✅ Badminton Singles seeded");
}

/* ══════════════════════════════════════════════════════════════════════════
   BADMINTON DOUBLES
   ══════════════════════════════════════════════════════════════════════════ */

async function seedBadmintonDoubles() {
    console.log("🏸 Seeding Badminton Doubles...");

    await wipeEvent("badminton_doubles");

    // Create placeholder teams
    const doublesTeams = [
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
    await createTeams(doublesTeams, "badminton_doubles");

    // Friday heats (20:00–22:00 SGT)
    const heats = [
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
        await putMatch(`D-Q${q++}`, {
            a: h.a,
            b: h.b,
            venue: h.c,
            time: new Date(fri.getTime() + h.s * 10 * 60 * 1000),
            pool: h.a.startsWith("DA") ? "A" : "B",
            type: "qualifier",
            eventId: "badminton_doubles",
        });
    }

    // Saturday BO3 series
    const sat1300 = new Date("2025-08-23T05:00:00Z"); // 13:00 SGT
    const sat1400 = new Date("2025-08-23T06:00:00Z"); // 14:00 SGT

    // Semifinals
    for (const br of [
        { id: "D-SF1", court: "Court 1", A: "D1", B: "D4" },
        { id: "D-SF2", court: "Court 2", A: "D2", B: "D3" },
    ]) {
        for (let g = 1; g <= 3; g++) {
            await putMatch(`${br.id}-${g}`, {
                a: br.A,
                b: br.B,
                venue: br.court,
                time: new Date(sat1300.getTime() + (g - 1) * 15 * 60 * 1000),
                type: "semi",
                eventId: "badminton_doubles",
            });
        }
    }

    // Bronze & Final series
    for (const tag of ["F", "B"]) {
        const court = tag === "F" ? "Court 1" : "Court 2";
        const A = tag === "F" ? "DFW1" : "DBW1";
        const B = tag === "F" ? "DFW2" : "DBW2";
        const type = tag === "F" ? "final" : "bronze";

        for (let g = 1; g <= 3; g++) {
            await putMatch(`D-${tag}${g}`, {
                a: A,
                b: B,
                venue: court,
                time: new Date(sat1400.getTime() + (g - 1) * 15 * 60 * 1000),
                type,
                eventId: "badminton_doubles",
            });
        }
    }

    console.log("✅ Badminton Doubles seeded");
}

/* ══════════════════════════════════════════════════════════════════════════
   FRISBEE 5V5
   ══════════════════════════════════════════════════════════════════════════ */

async function seedFrisbee() {
    console.log("🥏 Seeding Frisbee 5v5...");

    await wipeEvent("frisbee5v5");

    // Create placeholder teams
    const frisbeeTeams = [
        ...["A", "B", "C"].flatMap((p) =>
            Array.from({ length: 4 }, (_, i) => `${p}${i + 1}`)
        ),
        "FR1W",
        "FR2W",
        "FSF1W",
        "FSF2W",
        "FSF1L",
        "FSF2L",
        "FCHAMP",
        "IBP",
    ];
    await createTeams(frisbeeTeams, "frisbee5v5");

    // Round robin qualifiers
    const qualMatches = [
        // Pool A
        {
            id: "F-Q1",
            a: "A1",
            b: "A2",
            venue: "Field 1",
            time: sgt(7, 45),
            pool: "A",
        },
        {
            id: "F-Q2",
            a: "A3",
            b: "A4",
            venue: "Field 2",
            time: sgt(7, 45),
            pool: "A",
        },
        {
            id: "F-Q3",
            a: "A1",
            b: "A3",
            venue: "Field 1",
            time: sgt(8, 5),
            pool: "A",
        },
        {
            id: "F-Q4",
            a: "A2",
            b: "A4",
            venue: "Field 2",
            time: sgt(8, 5),
            pool: "A",
        },
        {
            id: "F-Q5",
            a: "A1",
            b: "A4",
            venue: "Field 1",
            time: sgt(8, 25),
            pool: "A",
        },
        {
            id: "F-Q6",
            a: "A2",
            b: "A3",
            venue: "Field 2",
            time: sgt(8, 25),
            pool: "A",
        },
        // Pool B
        {
            id: "F-Q7",
            a: "B1",
            b: "B2",
            venue: "Field 3",
            time: sgt(7, 45),
            pool: "B",
        },
        {
            id: "F-Q8",
            a: "B3",
            b: "B4",
            venue: "Field 1",
            time: sgt(7, 55),
            pool: "B",
        },
        {
            id: "F-Q9",
            a: "B1",
            b: "B3",
            venue: "Field 3",
            time: sgt(8, 5),
            pool: "B",
        },
        {
            id: "F-Q10",
            a: "B2",
            b: "B4",
            venue: "Field 1",
            time: sgt(8, 15),
            pool: "B",
        },
        {
            id: "F-Q11",
            a: "B1",
            b: "B4",
            venue: "Field 1",
            time: sgt(8, 35),
            pool: "B",
        },
        {
            id: "F-Q12",
            a: "B2",
            b: "B3",
            venue: "Field 2",
            time: sgt(8, 35),
            pool: "B",
        },
        // Pool C
        {
            id: "F-Q13",
            a: "C1",
            b: "C2",
            venue: "Field 2",
            time: sgt(7, 55),
            pool: "C",
        },
        {
            id: "F-Q14",
            a: "C3",
            b: "C4",
            venue: "Field 3",
            time: sgt(7, 55),
            pool: "C",
        },
        {
            id: "F-Q15",
            a: "C1",
            b: "C3",
            venue: "Field 2",
            time: sgt(8, 15),
            pool: "C",
        },
        {
            id: "F-Q16",
            a: "C2",
            b: "C4",
            venue: "Field 3",
            time: sgt(8, 15),
            pool: "C",
        },
        {
            id: "F-Q17",
            a: "C1",
            b: "C4",
            venue: "Field 3",
            time: sgt(8, 25),
            pool: "C",
        },
        {
            id: "F-Q18",
            a: "C2",
            b: "C3",
            venue: "Field 3",
            time: sgt(8, 35),
            pool: "C",
        },
    ];

    for (const match of qualMatches) {
        await putMatch(match.id, {
            ...match,
            type: "qualifier",
            eventId: "frisbee5v5",
        });
    }

    // Elimination matches
    const elimMatches = [
        // Redemption
        {
            id: "F-R1",
            a: "A3",
            b: "B3",
            venue: "Field 1",
            time: sgt(8, 55),
            type: "redemption",
        },
        {
            id: "F-R2",
            a: "C3",
            b: "A4",
            venue: "Field 2",
            time: sgt(8, 55),
            type: "redemption",
        },
        // Quarterfinals
        {
            id: "F-QF1",
            a: "A1",
            b: "B2",
            venue: "Field 1",
            time: sgt(9, 5),
            type: "qf",
        },
        {
            id: "F-QF2",
            a: "B1",
            b: "A2",
            venue: "Field 2",
            time: sgt(9, 5),
            type: "qf",
        },
        {
            id: "F-QF3",
            a: "C1",
            b: "FR1W",
            venue: "Field 1",
            time: sgt(9, 15),
            type: "qf",
        },
        {
            id: "F-QF4",
            a: "C2",
            b: "FR2W",
            venue: "Field 2",
            time: sgt(9, 15),
            type: "qf",
        },
        // Semifinals
        {
            id: "F-SF1",
            a: "BQF1W",
            b: "BQF3W",
            venue: "Field 1",
            time: sgt(9, 35),
            type: "semi",
        },
        {
            id: "F-SF2",
            a: "BQF2W",
            b: "BQF4W",
            venue: "Field 2",
            time: sgt(9, 35),
            type: "semi",
        },
        // Bronze/Final/Bonus
        {
            id: "F-B1",
            a: "FSF1L",
            b: "FSF2L",
            venue: "Field 1",
            time: sgt(9, 55),
            type: "bronze",
        },
        {
            id: "F-F1",
            a: "FSF1W",
            b: "FSF2W",
            venue: "Field 1",
            time: sgt(10, 5),
            type: "final",
        },
        {
            id: "F-BON1",
            a: "FCHAMP",
            b: "IBP",
            venue: "Field 1",
            time: sgt(10, 25),
            type: "bonus",
        },
    ];

    for (const match of elimMatches) {
        await putMatch(match.id, { ...match, eventId: "frisbee5v5" });
    }

    console.log("✅ Frisbee 5v5 seeded");
}

/* ══════════════════════════════════════════════════════════════════════════
   BASKETBALL 3V3
   ══════════════════════════════════════════════════════════════════════════ */

async function seedBasketball() {
    console.log("🏀 Seeding Basketball 3v3...");

    await wipeEvent("basketball3v3");

    // Create placeholder teams
    const basketballTeams = [
        ...["A", "B", "C", "D"].flatMap((p) =>
            Array.from({ length: 4 }, (_, i) => `${p}${i + 1}`)
        ),
        ...Array.from({ length: 8 }, (_, i) => `BW${i + 1}`),
        "BQF1W",
        "BQF2W",
        "BQF3W",
        "BQF4W",
        "BSF1W",
        "BSF2W",
        "BSF1L",
        "BSF2L",
    ];
    await createTeams(basketballTeams, "basketball3v3");

    // Qualifier times (SGT)
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

    // Seed qualifiers (round-robin per pool)
    const pools = ["A", "B", "C", "D"];
    let qn = 1;
    for (let p = 0; p < pools.length; p++) {
        const P = pools[p];
        const base = p * 3;

        // Round 1: (1v2) & (3v4)
        await putMatch(`B-Q${qn++}`, {
            a: `${P}1`,
            b: `${P}2`,
            venue: "Court 1",
            time: sgt(...QUAL_SLOTS_SGT[base + 0]),
            type: "qualifier",
            pool: P,
            eventId: "basketball3v3",
        });
        await putMatch(`B-Q${qn++}`, {
            a: `${P}3`,
            b: `${P}4`,
            venue: "Court 2",
            time: sgt(...QUAL_SLOTS_SGT[base + 0]),
            type: "qualifier",
            pool: P,
            eventId: "basketball3v3",
        });

        // Round 2: (1v3) & (2v4)
        await putMatch(`B-Q${qn++}`, {
            a: `${P}1`,
            b: `${P}3`,
            venue: "Court 1",
            time: sgt(...QUAL_SLOTS_SGT[base + 1]),
            type: "qualifier",
            pool: P,
            eventId: "basketball3v3",
        });
        await putMatch(`B-Q${qn++}`, {
            a: `${P}2`,
            b: `${P}4`,
            venue: "Court 2",
            time: sgt(...QUAL_SLOTS_SGT[base + 1]),
            type: "qualifier",
            pool: P,
            eventId: "basketball3v3",
        });

        // Round 3: (1v4) & (2v3)
        await putMatch(`B-Q${qn++}`, {
            a: `${P}1`,
            b: `${P}4`,
            venue: "Court 1",
            time: sgt(...QUAL_SLOTS_SGT[base + 2]),
            type: "qualifier",
            pool: P,
            eventId: "basketball3v3",
        });
        await putMatch(`B-Q${qn++}`, {
            a: `${P}2`,
            b: `${P}3`,
            venue: "Court 2",
            time: sgt(...QUAL_SLOTS_SGT[base + 2]),
            type: "qualifier",
            pool: P,
            eventId: "basketball3v3",
        });
    }

    // Elimination matches
    const elimMatches = [
        {
            id: "B-QF1",
            a: "BW1",
            b: "BW8",
            venue: "Court 1",
            time: sgt(17, 20),
            type: "qf",
        },
        {
            id: "B-QF2",
            a: "BW2",
            b: "BW7",
            venue: "Court 2",
            time: sgt(17, 20),
            type: "qf",
        },
        {
            id: "B-QF3",
            a: "BW3",
            b: "BW6",
            venue: "Court 1",
            time: sgt(17, 30),
            type: "qf",
        },
        {
            id: "B-QF4",
            a: "BW4",
            b: "BW5",
            venue: "Court 2",
            time: sgt(17, 30),
            type: "qf",
        },
        {
            id: "B-SF1",
            a: "BQF1W",
            b: "BQF2W",
            venue: "Court 1",
            time: sgt(17, 45),
            type: "semi",
        },
        {
            id: "B-SF2",
            a: "BQF3W",
            b: "BQF4W",
            venue: "Court 2",
            time: sgt(17, 45),
            type: "semi",
        },
        {
            id: "B-B1",
            a: "BSF1L",
            b: "BSF2L",
            venue: "Court 1",
            time: sgt(18, 0),
            type: "bronze",
        },
        {
            id: "B-F1",
            a: "BSF1W",
            b: "BSF2W",
            venue: "Court 1",
            time: sgt(18, 12),
            type: "final",
        },
    ];

    for (const match of elimMatches) {
        await putMatch(match.id, { ...match, eventId: "basketball3v3" });
    }

    console.log("✅ Basketball 3v3 seeded");
}

/* ══════════════════════════════════════════════════════════════════════════
   MAIN EXECUTION
   ══════════════════════════════════════════════════════════════════════════ */

async function main() {
    console.log("🚀 Seeding ALL tournament matches...\n");

    try {
        await seedBadmintonSingles();
        await seedBadmintonDoubles();
        await seedFrisbee();
        await seedBasketball();

        console.log("\n🎉 ALL MATCHES SEEDED SUCCESSFULLY!");
        console.log("📊 Tournament schedule is ready!");
    } catch (error) {
        console.error("❌ Error seeding matches:", error);
        process.exit(1);
    }

    process.exit(0);
}

main();
