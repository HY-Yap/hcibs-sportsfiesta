// scripts/reset-matches.mjs
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const serviceAccount = require("./serviceAccountKey.json");

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

/* map a matchId to placeholder teams (when we want to revert brackets) */
function placeholderFor(eventId, matchId) {
    // Badminton helper
    const bk = (prefix) => {
        if (new RegExp(`^${prefix}-SF1-\\d$`).test(matchId))
            return { a: `${prefix}1`, b: `${prefix}4` };
        if (new RegExp(`^${prefix}-SF2-\\d$`).test(matchId))
            return { a: `${prefix}2`, b: `${prefix}3` };
        if (new RegExp(`^${prefix}-F[123]$`).test(matchId))
            return { a: `${prefix}FW1`, b: `${prefix}FW2` };
        if (new RegExp(`^${prefix}-B[123]$`).test(matchId))
            return { a: `${prefix}BW1`, b: `${prefix}BW2` };
        return null;
    };

    if (eventId === "badminton_singles") return bk("S");
    if (eventId === "badminton_doubles") return bk("D");

    if (eventId === "basketball3v3") {
        // QFs
        if (matchId === "B-QF1") return { a: "BW1", b: "BW8" };
        if (matchId === "B-QF2") return { a: "BW2", b: "BW7" };
        if (matchId === "B-QF3") return { a: "BW3", b: "BW6" };
        if (matchId === "B-QF4") return { a: "BW4", b: "BW5" };
        // SFs
        if (matchId === "B-SF1") return { a: "BQF1W", b: "BQF2W" };
        if (matchId === "B-SF2") return { a: "BQF3W", b: "BQF4W" };
        // Bronze / Final
        if (matchId === "B-B1") return { a: "BSF1L", b: "BSF2L" };
        if (matchId === "B-F1") return { a: "BSF1W", b: "BSF2W" };
    }

    return null;
}

const snap = await db.collection("matches").get();
const batch = db.batch();

snap.forEach((d) => {
    const m = d.data();
    const base = placeholderFor(m.event_id, d.id);

    const payload = {
        status: "scheduled",
        // use nulls so UI shows "–"
        score_a: null,
        score_b: null,
        actual_start: FieldValue.delete(),
    };

    if (base) {
        payload.competitor_a = { id: base.a };
        payload.competitor_b = { id: base.b };
    }

    batch.update(d.ref, payload);
});

await batch.commit();
console.log(
    `🔄 reset ${snap.size} matches to scheduled (scores cleared, placeholders restored where applicable)`
);

// wipe awards too
const awardsSnap = await db.collection("awards").get();
const awardsBatch = db.batch();
awardsSnap.forEach((d) => awardsBatch.delete(d.ref));
await awardsBatch.commit();
console.log(`🗑️  deleted ${awardsSnap.size} award documents`);

process.exit(0);
