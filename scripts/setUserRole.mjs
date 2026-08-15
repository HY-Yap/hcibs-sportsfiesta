#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

const [, , rawEmail, rawRole] = process.argv;
const email = rawEmail?.trim().toLowerCase();
const role = rawRole?.trim().toLowerCase();
const allowedRoles = new Set(["player", "scorekeeper", "admin"]);

function usage() {
    console.log("Usage: node scripts/setUserRole.mjs <email> <role>");
    console.log(
        "Example: node scripts/setUserRole.mjs player@example.com player"
    );
    console.log("Allowed roles: player, scorekeeper, admin");
}

if (!email || !allowedRoles.has(role)) {
    usage();
    process.exit(1);
}

let serviceAccount;
try {
    const keyUrl = new URL("./serviceAccountKey.json", import.meta.url);
    serviceAccount = JSON.parse(await readFile(keyUrl, "utf8"));
} catch (error) {
    if (error.code === "ENOENT") {
        console.error(
            "Missing scripts/serviceAccountKey.json. Download a Firebase Admin SDK private key and place it there."
        );
    } else {
        console.error(`Unable to read the service account key: ${error.message}`);
    }
    process.exit(1);
}

initializeApp({
    credential: cert(serviceAccount),
    projectId: serviceAccount.project_id,
});

const auth = getAuth();
const db = getFirestore();

try {
    const user = await auth.getUserByEmail(email);
    const previousClaims = user.customClaims || {};
    const previousUserDoc = await db.doc(`users/${user.uid}`).get();
    const previousFirestoreRole = previousUserDoc.exists
        ? previousUserDoc.data().role || "(none)"
        : "(missing user document)";

    console.log(`User: ${email}`);
    console.log(`Previous Auth claim role: ${previousClaims.role || "(none)"}`);
    console.log(`Previous Firestore role: ${previousFirestoreRole}`);

    // setCustomUserClaims replaces the claims object, so retain any unrelated
    // claims while changing only the role.
    await auth.setCustomUserClaims(user.uid, {
        ...previousClaims,
        role,
    });

    await db.doc(`users/${user.uid}`).set(
        {
            email: user.email,
            role,
            updated_at: new Date(),
        },
        { merge: true }
    );

    console.log(`Updated Auth claim role: ${role}`);
    console.log(`Updated Firestore role: ${role}`);
    console.log("Done. Log out of the website and log back in to refresh the token.");
} catch (error) {
    if (error.code === "auth/user-not-found") {
        console.error(`No Firebase Authentication user exists for ${email}.`);
    } else {
        console.error(`Failed to update the role: ${error.message}`);
    }
    process.exit(1);
}
