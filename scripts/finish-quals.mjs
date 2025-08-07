#!/usr/bin/env node
/**
 * finish-quals.mjs
 * -------------------------------------------------------------
 * Force-completes every *qualifier* match for the specified events,
 * taking them through the required `live → final` transition so that
 * trigger functions (revealSemis, etc.) fire.
 *
 *   node scripts/finish-quals.mjs badminton_doubles badminton_singles
 *
 * With no args, it runs for *all* events that still have unfinished
 * qualifier matches.
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import key from "./serviceAccountKey.json" assert { type: "json" };

initializeApp({ credential: cert(key), projectId: "hcibs-sportsfiesta" });
const db = getFirestore();

/* ─── CLI args ─── */
const wanted = process.argv.slice(2); // event_ids to process (optional)

/* ─── helper to generate badminton-ish score (18-23) ─── */
const rndScore = () => 18 + Math.floor(Math.random() * 6);

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

    /* skip other events if user passed filters */
    if (wanted.length && !wanted.includes(d.event_id)) continue;

    /* 1️⃣ -> LIVE  */
    if (d.status !== "live") {
        await doc.ref.update({
            status: "live",
            actual_start: FieldValue.serverTimestamp(),
        });
    }

    /* 2️⃣ -> FINAL (random scores) */
    await doc.ref.update({
        status: "final",
        score_a: rndScore(),
        score_b: rndScore(),
    });

    touched++;
}

console.log(`✅ Processed ${touched} qualifier${touched !== 1 ? "s" : ""}.`);
process.exit(0);
