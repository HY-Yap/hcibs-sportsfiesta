// scripts/setClaims.mjs
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import fs from "node:fs";

const serviceAccount = JSON.parse(
    fs.readFileSync(new URL("./serviceAccountKey.json", import.meta.url))
);

initializeApp({ credential: cert(serviceAccount) });

const auth = getAuth();

// ---------- REPLACE with real UIDs -------------
const UIDS = {
    admin: "8U1gpGrMS3fMHQOKU2uk7N3NC103",
    score: "95i5zv4oaUNU1edxsUEHzQVFReu2",
    alice: "9jeFqQlPbsWvI4gmXC5nf6oNXrD3",
    bob: "puVCl0LzWmd4t8xWu07dADIkTR63",
};
// -----------------------------------------------

await auth.setCustomUserClaims(UIDS.admin, { role: "admin" });
await auth.setCustomUserClaims(UIDS.score, { role: "scorekeeper" });
await auth.setCustomUserClaims(UIDS.alice, { role: "participant" });
await auth.setCustomUserClaims(UIDS.bob, { role: "participant" });

console.log("✅  Custom claims set for seed users");
process.exit(0);
