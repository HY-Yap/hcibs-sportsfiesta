import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import key from "./serviceAccountKey.json" assert { type: "json" };

// Usage: node scripts/createUser.mjs <email> <password> [full_name]
const [, , email, password, fullName = "Player"] = process.argv;

if (!email || !password) {
    console.error(
        "Usage: node scripts/createUser.mjs <email> <password> [full_name]"
    );
    process.exit(1);
}

initializeApp({ credential: cert(key), projectId: key.project_id });
const auth = getAuth();
const db = getFirestore();

async function main() {
    // Create user in Firebase Auth
    const user = await auth.createUser({
        email,
        password,
        displayName: fullName,
    });

    // Set custom claim for player role
    await auth.setCustomUserClaims(user.uid, { role: "player" });

    // Create Firestore user document
    await db.collection("users").doc(user.uid).set({
        email,
        full_name: fullName,
        role: "player",
        created_at: new Date(),
        uid: user.uid,
    });

    console.log(`✅ Created player: ${email} (${fullName})`);
}

main().catch((err) => {
    console.error("❌ Error creating user:", err);
    process.exit(1);
});
