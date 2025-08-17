#!/usr/bin/env node
import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import key from "./serviceAccountKey.json" assert { type: "json" };

initializeApp({ credential: cert(key), projectId: key.project_id });
const auth = getAuth();

const [, , email, newPassword] = process.argv;

function usage() {
  console.log("Usage: node scripts/setPassword.mjs <email> <newPassword>");
  console.log("Example: node scripts/setPassword.mjs scorekeeper1@score.com NewTempPW123!");
}

if (!email || !newPassword) {
  usage();
  process.exit(1);
}

// Firebase requires at least 6 chars for passwords.
if (newPassword.length < 6) {
  console.error("❌ Password must be at least 6 characters.");
  process.exit(1);
}

try {
  const user = await auth.getUserByEmail(email); // will throw if not found
  await auth.updateUser(user.uid, { password: newPassword });
  console.log(`✅ Password updated for ${email}`);
  // Optional: revoke tokens so any existing sessions must re-login
  // await auth.revokeRefreshTokens(user.uid);
  process.exit(0);
} catch (e) {
  if (e.code === "auth/user-not-found") {
    console.error(`❌ No such user: ${email}`);
  } else {
    console.error(`❌ ${e.message}`);
  }
  process.exit(1);
}