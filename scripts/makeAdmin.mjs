// scripts/makeAdmin.mjs
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import key from "./serviceAccountKey.json" with { type: "json" };

initializeApp({ credential: cert(key), projectId: key.project_id });
const auth = getAuth();
const db = getFirestore();

async function makeAdmin(email) {
    if (!email) {
        console.error("❌ Please provide an email address");
        process.exit(1);
    }

    console.log(`🔧 Processing admin request for: ${email}`);

    try {
        let user;
        let userExists = false;

        // 1. Check if Firebase Auth user exists
        try {
            user = await auth.getUserByEmail(email);
            userExists = true;
            console.log(`✅ Firebase Auth user exists: ${email}`);
        } catch (e) {
            if (e.code === "auth/user-not-found") {
                // Create Firebase Auth user
                user = await auth.createUser({
                    email: email,
                    displayName: "Admin User",
                    password: "TempPassword123!",  // Change this immediately
                    emailVerified: true,
                    disabled: false,
                });
                console.log(`✅ Created Firebase Auth user: ${email}`);
                console.log(`🔑 Temporary password: TempPassword123!`);
            } else {
                throw e;
            }
        }

        // 2. Set admin role in custom claims
        await auth.setCustomUserClaims(user.uid, { role: "admin" });
        console.log(`🔧 Set admin role for ${email}`);

        // 3. Check if Firestore user document exists
        const userDocRef = db.doc(`users/${user.uid}`);
        const userDoc = await userDocRef.get();

        if (userDoc.exists) {
            // Update existing document to admin role
            await userDocRef.update({
                role: "admin",
                updated_at: new Date(),
            });
            console.log(`📝 Updated existing user document to admin role`);
        } else {
            // Create new user document
            await userDocRef.set({
                full_name: "Admin User",
                email: email,
                role: "admin",
                created_at: new Date(),
                updated_at: new Date(),
            });
            console.log(`📝 Created new user document with admin role`);
        }

        console.log(`🎉 Successfully made ${email} an admin!`);
        
        if (!userExists) {
            console.log(`⚠️  Remember to change the temporary password: TempPassword123!`);
        }

    } catch (error) {
        console.error(`❌ Failed to make ${email} admin:`, error.message);
        process.exit(1);
    }
}

// Get email from command line argument
const email = process.argv[2];

if (!email) {
    console.log("Usage: node scripts/makeAdmin.mjs <email>");
    console.log("Example: node scripts/makeAdmin.mjs yaphanyang09@gmail.com");
    process.exit(1);
}

await makeAdmin(email);