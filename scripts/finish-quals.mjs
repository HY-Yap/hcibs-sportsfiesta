#!/usr/bin/env node
/**
 * finish-quals.mjs
 * -------------------------------------------------------------
 * Force-completes every *qualifier* match for the specified events,
 * taking them through `live → final`, using sport-flavoured scores:
 *  - badminton_singles / badminton_doubles: winner = 15, loser 0–14
 *  - basketball3v3: winner 12–21, loser (winner-8 .. winner-1)
 *  - frisbee5v5: winner 4–9, loser 0..(winner-1)
 *
 *   node scripts/finish-quals.mjs badminton_doubles badminton_singles
 *   # with no args: processes all events that have unfinished qualifiers
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import key from "./serviceAccountKey.json" assert { type: "json" };

initializeApp({ credential: cert(key), projectId: "hcibs-sportsfiesta" });
const db = getFirestore();

/* ─── CLI args ─── */
const wanted = process.argv.slice(2); // optional list of event_ids

/* ─── utils ─── */
const ri = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * Generate sport-appropriate scores for a qualifier.
 * Returns [scoreA, scoreB] (already assigned to A/B randomly).
 */
function genScores(eventId) {
    let win, lose;

    if (eventId === "badminton_singles" || eventId === "badminton_doubles") {
        // Winner always hits 15, no overtime. Bias loser toward mid teens.
        win = 15;
        // 70% chance 9–13, 20% chance 6–8, 7% blowout 0–5, 3% 14–15 thriller
        const bucket = Math.random();
        if (bucket < 0.7) lose = ri(9, 13);
        else if (bucket < 0.9) lose = ri(6, 8);
        else if (bucket < 0.97) lose = ri(0, 5);
        else lose = 14; // 15–14 classic
    } else if (eventId === "basketball3v3") {
        // Winner 12–21, loser within 1–8 points behind (skewed closer)
        const w = ri(12, 21);
        // Bias margin: 1-3 common, 4-6 sometimes, 7-8 rare
        const margin = pick([1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 6, 7, 8]);
        win = w;
        lose = Math.max(0, w - margin);
    } else if (eventId === "frisbee5v5") {
        // Short slots, low scores
        win = ri(4, 9);
        // Keep at least a 1-point margin
        lose = ri(0, win - 1);
    } else {
        // Fallback: vaguely reasonable
        const a = ri(5, 20),
            b = ri(5, 20);
        if (a === b) return genScores(eventId); // avoid tie
        return Math.random() < 0.5 ? [a, b] : [b, a];
    }

    // Randomly assign which side (A or B) is the winner
    return Math.random() < 0.5 ? [win, lose] : [lose, win];
}

let touched = 0;

/* ─── fetch all unfinished qualifiers ─── */
const snap = await db
    .collection("matches")
    .where("match_type", "==", "qualifier")
    .where("status", "in", ["scheduled", "live"])
    .get();

/* ─── iterate & flip each doc ─── */
for (const doc of snap.docs) {
    const d = doc.data();

    // Skip non-requested events if args provided
    if (wanted.length && !wanted.includes(d.event_id)) continue;

    // Step 1: -> LIVE (only if still scheduled)
    if (d.status !== "live") {
        await doc.ref.update({
            status: "live",
            actual_start: FieldValue.serverTimestamp(),
        });
    }

    // Step 2: -> FINAL with sport-flavoured scores
    const [score_a, score_b] = genScores(d.event_id);

    // Avoid accidental tie from fallback branch
    if (score_a === score_b) {
        const tweak = Math.random() < 0.5 ? 1 : -1;
        if (score_a + tweak >= 0) {
            // small nudge
            score_a += tweak;
        } else {
            score_b += 1;
        }
    }

    await doc.ref.update({
        status: "final",
        score_a,
        score_b,
    });

    touched++;
}

console.log(`✅ Processed ${touched} qualifier${touched !== 1 ? "s" : ""}.`);
process.exit(0);
