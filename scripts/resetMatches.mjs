// scripts/reset-matches.mjs
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import serviceAccount from "./serviceAccountKey.json" assert { type: "json" };
// -- adjust the relative path above if your key isn’t in scripts/

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

const snap = await db.collection("matches").get();
const batch = db.batch();

snap.forEach((d) => {
    batch.update(d.ref, {
        status: "scheduled",
        score_a: 0,
        score_b: 0,
        actual_start: FieldValue.delete(),
    });
});

await batch.commit();
console.log(`🔄  reset ${snap.size} matches to 0-0, status=scheduled`);
process.exit(0);
