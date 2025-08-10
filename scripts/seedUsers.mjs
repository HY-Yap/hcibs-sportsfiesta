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
import key from "./serviceAccountKey.json" assert { type: "json" };

initializeApp({ credential: cert(key), projectId: key.project_id });
const auth = getAuth();
const db = getFirestore();

// ---------- CLI ----------
const argv = Object.fromEntries(
    process.argv.slice(2).map((a) => {
        const [k, v] = a.split("=");
        return [k.replace(/^--/, ""), v ?? true];
    })
);

const PLAYERS_CSV = argv.players || "./players.csv";
const TEAMS_CSV = argv.teams || "./teams.csv";
const DRY_RUN = !!argv.dry;
const DO_INVITE = !!argv.invite;

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

        const phone = norm.phone(r.phone);
        const accommodation = norm.str(r.accommodation || r.accomodation);
        const meals = norm.str(r.meals);
        const is_guest = norm
            .str(r.is_guest || r.guest || "")
            .toLowerCase()
            .trim();

        players.push({
            full_name,
            email,
            phone,
            accommodation: accommodation || null,
            meals: meals || null,
            is_guest: ["true", "yes", "y", "1"].includes(is_guest),
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
            // no password; we'll optionally send reset link
            emailVerified: false,
            disabled: false,
        });
        // set a simple role claim; optional
        await auth.setCustomUserClaims(u.uid, { role: "player" });
        return { uid: u.uid, created: true };
    }
}

// ---------- upsert user doc ----------
async function upsertUserDoc(uid, p) {
    if (DRY_RUN) return;
    const ref = db.doc(`users/${uid}`);
    await ref.set(
        {
            full_name: p.full_name,
            email: p.email,
            phone: p.phone || null,
            accommodation: p.accommodation ?? null,
            meals: p.meals ?? null,
            is_guest: !!p.is_guest,
            role: "player",
            updated_at: new Date(),
            created_at: (await ref.get()).exists ? undefined : new Date(),
        },
        { merge: true }
    );
}

// ---------- add member_uids to teams ----------
async function updateTeamsWithUids(teams, emailToUid) {
    if (DRY_RUN) return { touched: 0, missing: 0 };

    let touched = 0;
    let missing = 0;
    for (const t of teams) {
        // find team doc by (event_id, name)
        const snap = await db
            .collection("teams")
            .where("event_id", "==", t.event_id)
            .where("name", "==", t.team_name)
            .get();

        if (snap.empty) {
            missing++;
            continue;
        }
        const member_uids = t.member_emails
            .map((e) => emailToUid.get(e))
            .filter(Boolean);

        // update every matching doc (usually 1)
        const batches = chunk(snap.docs, 400);
        for (const docs of batches) {
            const batch = db.batch();
            docs.forEach((d) => {
                batch.set(
                    d.ref,
                    { member_uids, member_emails: t.member_emails },
                    { merge: true }
                );
            });
            await batch.commit();
            await sleep(25);
        }
        touched += snap.size;
    }
    return { touched, missing };
}

// ---------- optional invites ----------
async function maybeSendInvites(emailToUid) {
    if (!DO_INVITE || DRY_RUN) return;
    const out = [];
    for (const [email] of emailToUid) {
        try {
            const link = await auth.generatePasswordResetLink(email);
            out.push({ email, reset_link: link });
            // tiny throttle
            await sleep(100);
        } catch (e) {
            console.warn(`Invite failed for ${email}:`, e.message);
        }
    }
    if (out.length) {
        const csv = Papa.unparse(out);
        const file = path.resolve("./invites.csv");
        await fs.writeFile(file, csv, "utf8");
        console.log(`📧 wrote ${out.length} reset links to ${file}`);
    }
}

// ---------- main ----------
async function main() {
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

    // update team docs with member_uids
    const teamRes = await updateTeamsWithUids(teams, emailToUid);
    console.log(
        `📝 updated member_uids on ${teamRes.touched} team doc(s) (${teamRes.missing} not found by event+name)`
    );

    // optional invites
    await maybeSendInvites(emailToUid);

    console.log("🎉 done.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
