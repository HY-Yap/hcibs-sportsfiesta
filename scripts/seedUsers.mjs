// scripts/seedUsersFromCsv.mjs
/**
 * Seed users from CSVs (players.csv + teams.csv).
 * - Creates/ensures Firebase Auth users by email
 * - Upserts users/{uid} docs with profile fields
 * - Adds member_uids to matching teams (event_id + team_name)
 *
 * Usage:
 *   node scripts/seedUsersFromCsv.mjs --players ./data/players.csv --teams ./data/teams.csv [--invite] [--dry]
 *
 * Flags:
 *   --invite   also generate password reset links (printed + saved to invites.csv)
 *   --dry      parse & log only; no writes
 */

import { initializeApp, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import fs from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const key = require('./serviceAccountKey.json');
import readline from "readline";

initializeApp({ credential: cert(key), projectId: key.project_id });
const auth = getAuth();
const db = getFirestore();

function confirm(message) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(message, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

// ---------- CLI ----------
function parseArgs() {
    const args = process.argv.slice(2);
    const parsed = {};

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];

        if (arg.startsWith("--")) {
            const key = arg.replace(/^--/, "");

            // Check if next argument is a value (doesn't start with --)
            if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
                parsed[key] = args[i + 1];
                i++; // Skip the next argument since it's a value
            } else {
                // It's a flag without a value
                parsed[key] = true;
            }
        }
    }

    return parsed;
}

const argv = parseArgs();

const PLAYERS_CSV = argv.players || "./players.csv";
const TEAMS_CSV = argv.teams || "./teams.csv";
const DRY_RUN = !!argv.dry;
const DO_INVITE = !!argv.invite;
const RESET_PLAYERS = !!argv["reset-players"];

// ---------- utils ----------
const norm = {
    email: (s) => (s || "").toString().trim().toLowerCase(),
    phone: (s) =>
        (s || "")
            .toString()
            .replace(/[^\d+]/g, "")
            .trim(),
    str: (s) => (s || "").toString().trim(),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readCsv(file) {
    const text = await fs.readFile(path.resolve(file), "utf8");
    return new Promise((resolve, reject) => {
        Papa.parse(text, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (h) => h.trim(),
            complete: (res) => resolve(res.data),
            error: reject,
        });
    });
}

function chunk(arr, n = 400) {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
}

// ---------- reset all players ----------
async function resetAllPlayers() {
    console.log("🧹 Starting complete player reset...");

    let deletedAuth = 0;
    let deletedDocs = 0;

    try {
        // 1. Get all Firebase Auth users
        const listUsersResult = await auth.listUsers(1000);
        const allUsers = listUsersResult.users;

        // 2. Delete Firebase Auth users (except admins/scorekeepers)
        for (const user of allUsers) {
            try {
                // Get custom claims to check role
                const userRecord = await auth.getUser(user.uid);
                const claims = userRecord.customClaims || {};

                // Skip admins and scorekeepers
                if (claims.role === "admin" || claims.role === "scorekeeper") {
                    console.log(`🔒 Preserving ${claims.role}: ${user.email}`);
                    continue;
                }

                // Delete Auth user
                await auth.deleteUser(user.uid);
                deletedAuth++;
                console.log(`🗑️  Deleted Auth user: ${user.email}`);
            } catch (e) {
                console.warn(
                    `Failed to delete Auth user ${user.uid}:`,
                    e.message
                );
            }
        }

        // 3. Delete Firestore user documents with role=player
        const userDocsSnap = await db
            .collection("users")
            .where("role", "==", "player")
            .get();

        const deletePromises = [];
        userDocsSnap.forEach((doc) => {
            deletePromises.push(doc.ref.delete());
            deletedDocs++;
        });

        if (deletePromises.length > 0) {
            await Promise.all(deletePromises);
            console.log(`🗑️  Deleted ${deletedDocs} Firestore user documents`);
        }
    } catch (error) {
        console.error("❌ Reset failed:", error);
        throw error;
    }

    console.log(
        `✅ Player reset complete: ${deletedAuth} Auth users, ${deletedDocs} docs deleted`
    );
    return { deletedAuth, deletedDocs };
}

// ---------- parse players ----------
function validatePlayers(rows) {
    const errors = [];
    const players = [];
    const seen = new Set();

    rows.forEach((r, i) => {
        const row = i + 2;
        const full_name = norm.str(r.full_name);
        const email = norm.email(r.email);
        if (!full_name) errors.push(`Players row ${row}: missing full_name`);
        if (!email) errors.push(`Players row ${row}: missing email`);
        if (email && seen.has(email))
            errors.push(`Players row ${row}: duplicate email "${email}"`);
        seen.add(email);

        players.push({
            full_name,
            email,
        });
    });

    return { errors, players };
}

// ---------- parse teams ----------
function parseTeams(rows) {
    const teams = [];
    rows.forEach((r, i) => {
        const event_id = norm.str(r.event_id);
        const team_name = norm.str(r.team_name);
        const emails = norm
            .str(r.member_emails)
            .split(";")
            .map(norm.email)
            .filter(Boolean);
        if (!event_id || !team_name) return;
        teams.push({
            event_id,
            team_name,
            member_emails: Array.from(new Set(emails)),
        });
    });
    return teams;
}

// ---------- ensure auth user ----------
async function ensureAuthUser({ email, full_name }) {
    try {
        const u = await auth.getUserByEmail(email);
        return { uid: u.uid, created: false };
    } catch (e) {
        if (e.code !== "auth/user-not-found") throw e;
        if (DRY_RUN) return { uid: `dry_${email}`, created: true };

        const u = await auth.createUser({
            email,
            displayName: full_name,
            // 🔥 Don't set password here - we'll set it later with our generated one
            emailVerified: false,
            disabled: false,
        });

        // Set a simple role claim
        await auth.setCustomUserClaims(u.uid, { role: "player" });
        return { uid: u.uid, created: true };
    }
}

// ---------- upsert user doc ----------
async function upsertUserDoc(uid, p) {
    if (DRY_RUN) return;
    const ref = db.doc(`users/${uid}`);
    const docSnap = await ref.get();

    const data = {
        full_name: p.full_name,
        email: p.email,
        role: "player",
        updated_at: new Date(),
    };

    // Only set created_at for new documents
    if (!docSnap.exists) {
        data.created_at = new Date();
    }

    await ref.set(data, { merge: true });
}

// ---------- add member_uids to teams ----------
async function updateTeamsWithUids(teams, emailToUid) {
    let touched = 0;
    let missing = 0;

    console.log(`🔄 Processing ${teams.length} teams...`);

    for (const t of teams) {
        console.log(
            `🔍 [${touched + missing + 1}/${
                teams.length
            }] Looking for: event_id="${t.event_id}" team_name="${t.team_name}"`
        );

        try {
            // 🔥 Strategy 1: Try direct document ID (if team_name is actually a slot)
            const directDocId = `${t.event_id}__${t.team_name}`;
            let teamRef = db.doc(`teams/${directDocId}`);
            let teamDoc = await teamRef.get();

            if (teamDoc.exists) {
                console.log(`   ✅ Found via direct ID: ${directDocId}`);
            } else {
                // 🔥 Strategy 2: Search by name field
                console.log(
                    `   Direct ID "${directDocId}" not found, searching by name...`
                );

                const nameQuery = db
                    .collection("teams")
                    .where("event_id", "==", t.event_id)
                    .where("name", "==", t.team_name);

                const nameSnap = await nameQuery.get();

                if (!nameSnap.empty) {
                    teamRef = nameSnap.docs[0].ref;
                    teamDoc = nameSnap.docs[0];
                    console.log(`   ✅ Found via name query: ${teamRef.id}`);
                } else {
                    // 🔥 Strategy 3: Search by matching member emails
                    console.log(`   Name query failed, searching by emails...`);

                    const eventTeamsSnap = await db
                        .collection("teams")
                        .where("event_id", "==", t.event_id)
                        .get();

                    let foundMatch = null;
                    eventTeamsSnap.forEach((doc) => {
                        if (foundMatch) return; // Already found one

                        const data = doc.data();
                        const existingEmails = new Set(
                            data.member_emails || []
                        );
                        const csvEmails = new Set(t.member_emails);

                        // Check if email lists match exactly
                        if (
                            existingEmails.size === csvEmails.size &&
                            [...csvEmails].every((email) =>
                                existingEmails.has(email)
                            )
                        ) {
                            foundMatch = doc;
                        }
                    });

                    if (foundMatch) {
                        teamRef = foundMatch.ref;
                        teamDoc = foundMatch;
                        console.log(
                            `   ✅ Found via email match: ${foundMatch.id}`
                        );
                    } else {
                        console.log(
                            `   ❌ No team found for "${t.team_name}" in "${t.event_id}"`
                        );
                        console.log(`      Tried direct ID: ${directDocId}`);
                        console.log(
                            `      Tried name query: event_id="${t.event_id}" name="${t.team_name}"`
                        );
                        console.log(
                            `      Tried email matching with ${eventTeamsSnap.size} teams in event`
                        );
                        console.log(
                            `      CSV emails: [${t.member_emails
                                .slice(0, 3)
                                .join(", ")}${
                                t.member_emails.length > 3 ? "..." : ""
                            }]`
                        );
                        missing++;
                        continue;
                    }
                }
            }

            const teamData = teamDoc.data();
            console.log(
                `   📋 Team data: name="${teamData.name}" emails=[${(
                    teamData.member_emails || []
                )
                    .slice(0, 2)
                    .join(", ")}...]`
            );

            // Build member_uids from emails
            const member_uids = t.member_emails
                .map((e) => emailToUid.get(e))
                .filter(Boolean);

            console.log(
                `   📝 ${DRY_RUN ? "Would add" : "Adding"} ${
                    member_uids.length
                } member UIDs to ${teamRef.id}`
            );

            // Update the team document with UIDs (skip in dry run)
            if (!DRY_RUN) {
                await teamRef.set(
                    {
                        member_uids,
                        member_emails: t.member_emails, // Ensure emails are synced
                    },
                    { merge: true }
                );
            }

            touched++;
        } catch (error) {
            console.error(
                `   💥 Error processing team "${t.team_name}":`,
                error.message
            );
            missing++;
        }
    }

    return { touched, missing };
}

// ---------- generate default passwords ----------
function generatePassword(email, fullName) {
    // Generate a secure random string of 10 characters (letters + numbers)
    const chars =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let password = "";

    for (let i = 0; i < 10; i++) {
        password += chars[Math.floor(Math.random() * chars.length)];
    }

    return password;
}

async function maybeGeneratePasswords(emailToUid, players) {
    if (!DO_INVITE || DRY_RUN) return;

    const out = [];

    for (const player of players) {
        const { email, full_name } = player;
        const uid = emailToUid.get(email);

        if (!uid) continue;

        try {
            // 🔥 Check if user already has a password
            const user = await auth.getUser(uid);
            const hasPassword = user.passwordHash !== undefined;

            if (hasPassword) {
                console.log(`🔑 User ${email} already has password, skipping`);
                continue;
            }

            // Generate unique password
            const defaultPassword = generatePassword(email, full_name);

            // Set the password for the user
            await auth.updateUser(uid, {
                password: defaultPassword,
            });

            out.push({
                email,
                full_name,
                default_password: defaultPassword,
                uid,
            });

            console.log(`🔑 Set password for ${email}: ${defaultPassword}`);

            // Small delay to avoid rate limits
            await sleep(50);
        } catch (e) {
            console.warn(`Password generation failed for ${email}:`, e.message);
        }
    }

    if (out.length) {
        // Save to CSV file with timestamp for uniqueness
        const csv = Papa.unparse(out);
        const timestamp = new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/[:.]/g, "-");
        const file = path.resolve(`./user-credentials-${timestamp}.csv`);
        await fs.writeFile(file, csv, "utf8");
        console.log(`🔑 Wrote ${out.length} user credentials to ${file}`);
    }
}

// Add before main() function
async function cleanupOrphanedUsers(validEmails) {
    if (DRY_RUN) return;

    console.log("🧹 Checking for orphaned users...");
    const allUsers = await auth.listUsers(1000);
    const validEmailSet = new Set(validEmails);

    const toDelete = [];

    for (const user of allUsers.users) {
        // Skip if email is in current CSV
        if (validEmailSet.has(user.email)) continue;

        try {
            // Get custom claims to check role
            const userRecord = await auth.getUser(user.uid);
            const claims = userRecord.customClaims || {};

            // Skip admins and scorekeepers
            if (claims.role === "admin" || claims.role === "scorekeeper") {
                console.log(`🔒 Preserving ${claims.role}: ${user.email}`);
                continue;
            }

            // Mark for deletion (only players)
            toDelete.push(user);
        } catch (e) {
            console.warn(`Failed to check user ${user.uid}:`, e.message);
        }
    }

    if (toDelete.length > 0) {
        console.log(
            `🗑️  Found ${toDelete.length} orphaned player users, deleting...`
        );
        const deletePromises = toDelete.map((user) =>
            auth.deleteUser(user.uid)
        );
        await Promise.all(deletePromises);
    }
}

// ---------- main ----------
async function main() {
    // Handle reset mode
    if (RESET_PLAYERS) {
        if (DRY_RUN) {
            console.log("🔍 DRY RUN: Would reset all players...");
            return;
        }

        const ok = await confirm(
            "⚠️  DELETE ALL PLAYERS?\n\n" +
                "This will permanently delete:\n" +
                "• All Firebase Auth users (except admin/scorekeeper)\n" +
                "• All user profile documents with role=player\n\n" +
                "This CANNOT be undone! Continue? (y/N): "
        );

        if (ok.toLowerCase() !== "y") {
            console.log("❌ Reset cancelled.");
            return;
        }

        await resetAllPlayers();
        console.log("🎉 Reset complete.");
        return;
    }

    console.log("🧾 reading CSVs…");
    const [playersRows, teamsRows] = await Promise.all([
        readCsv(PLAYERS_CSV),
        readCsv(TEAMS_CSV),
    ]);

    const { errors, players } = validatePlayers(playersRows);
    if (errors.length) {
        console.error("❌ Players CSV has errors:");
        errors.forEach((e) => console.error(" -", e));
        process.exit(1);
    }
    const teams = parseTeams(teamsRows);

    console.log(
        `👥 players: ${players.length} | 🔗 team rows: ${teams.length} | dry: ${
            DRY_RUN ? "yes" : "no"
        }`
    );

    // 🧹 CLEANUP: Remove users not in current CSV
    const currentEmails = players.map((p) => p.email);
    await cleanupOrphanedUsers(currentEmails);

    // create/ensure users
    const emailToUid = new Map();
    let created = 0;
    for (const p of players) {
        const { uid, created: c } = await ensureAuthUser(p);
        emailToUid.set(p.email, uid);
        if (!DRY_RUN) await upsertUserDoc(uid, p);
        if (c) created++;
    }
    console.log(`✅ ensured ${players.length} users (${created} created)`);

    // Remove debug code (optional)
    // console.log("🔍 Debugging: Checking first few teams in Firestore...");
    // const sampleTeams = await db.collection("teams").limit(5).get();
    // sampleTeams.forEach((doc) => {
    //     const data = doc.data();
    //     console.log(`   📄 ${doc.id}:`);
    //     console.log(`      event_id: "${data.event_id}"`);
    //     console.log(`      name: "${data.name}"`);
    //     console.log(
    //         `      member_emails: [${(data.member_emails || [])
    //             .slice(0, 2)
    //             .join(", ")}...]`
    //     );
    // });

    // update team docs with member_uids
    const teamRes = await updateTeamsWithUids(teams, emailToUid);
    console.log(
        `📝 updated member_uids on ${teamRes.touched} team doc(s) (${teamRes.missing} not found by event+name)`
    );

    // optional invites
    await maybeGeneratePasswords(emailToUid, players);

    console.log("🎉 done.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
