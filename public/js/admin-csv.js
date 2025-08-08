// /js/admin-csv.js
// Admin — CSV import (players + teams) with validation against Firestore "events" + qualifier capacity.
// This file ONLY parses & validates. Writing to Firestore comes in the next step.

import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const db = window.firebase.db;

/* ----------------------------- DOM refs ----------------------------- */
const els = {
    playersInput: document.getElementById("csvPlayers"),
    teamsInput: document.getElementById("csvTeams"),
    playersStatus: document.getElementById("playersStatus"),
    teamsStatus: document.getElementById("teamsStatus"),
    btnValidate: document.getElementById("btnValidate"),
    btnClear: document.getElementById("btnClear"),
    csvStatus: document.getElementById("csvStatus"),
    statusMessages: document.getElementById("statusMessages"),
    loading: document.getElementById("loadingOverlay"),
    progressWrap: document.getElementById("progressContainer"),
    progressBar: document.getElementById("progressBar"),
    progressText: document.getElementById("progressText"),
    playerCount: document.getElementById("playerCount"),
    teamCount: document.getElementById("teamCount"),
    eventCount: document.getElementById("eventCount"),
    dbStatus: document.getElementById("dbStatus"),
    authStatus: document.getElementById("authStatus"),
    adminStatus: document.getElementById("adminStatus"),
};

/* ----------------------------- utils ----------------------------- */
const norm = {
    email: (s) => (s || "").toString().trim().toLowerCase(),
    phone: (s) =>
        (s || "")
            .toString()
            .replace(/[^\d+]/g, "")
            .trim(),
    str: (s) => (s || "").toString().trim(),
};
const uniq = (arr) => Array.from(new Set(arr));
const setProgress = (pct) => {
    els.progressWrap.classList.remove("hidden");
    els.progressBar.style.width = `${pct}%`;
    els.progressText.textContent = `${pct}%`;
};

function msg(html) {
    els.csvStatus.classList.remove("hidden");
    els.statusMessages.innerHTML = html;
}

/* ----------------------------- system status ----------------------------- */
(async function bootStatus() {
    // DB
    try {
        const evSnap = await getDocs(collection(db, "events"));
        els.dbStatus.innerHTML =
            '<i class="fas fa-circle text-green-500 mr-1"></i> Connected';
        els.eventCount.textContent = evSnap.size;
    } catch {
        els.dbStatus.innerHTML =
            '<i class="fas fa-circle text-red-500 mr-1"></i> Error';
    }

    // counts (best-effort, just for dashboard)
    try {
        const [users, teams] = await Promise.all([
            getDocs(collection(db, "users")),
            getDocs(collection(db, "teams")),
        ]);
        els.playerCount.textContent = users.size;
        els.teamCount.textContent = teams.size;
    } catch {
        // ignore
    }

    // Auth + admin (best-effort; your auth.js likely already handles UI)
    try {
        const user = window.firebase?.auth?.currentUser;
        if (!user) {
            els.authStatus.innerHTML =
                '<i class="fas fa-circle text-yellow-500 mr-1"></i> Not signed in';
            els.adminStatus.innerHTML =
                '<i class="fas fa-circle text-gray-400 mr-1"></i> Unknown';
            return;
        }
        els.authStatus.innerHTML =
            '<i class="fas fa-circle text-green-500 mr-1"></i> Signed in';

        const token = await user.getIdTokenResult(true);
        const role = token.claims?.role || "user";
        const isAdmin = role === "admin";
        els.adminStatus.innerHTML = isAdmin
            ? '<i class="fas fa-circle text-green-500 mr-1"></i> Admin'
            : `<i class="fas fa-circle text-red-500 mr-1"></i> ${role}`;
    } catch {
        els.authStatus.innerHTML =
            '<i class="fas fa-circle text-red-500 mr-1"></i> Error';
        els.adminStatus.innerHTML =
            '<i class="fas fa-circle text-gray-400 mr-1"></i> Unknown';
    }
})();

/* ----------------------------- CSV parse helpers ----------------------------- */
function parseCsvFile(file) {
    return new Promise((resolve, reject) => {
        window.Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            transformHeader: (h) => h.trim(),
            complete: (res) => resolve(res.data),
            error: reject,
        });
    });
}

function previewList(rows, max = 3) {
    if (!rows.length) return "<em>0 rows</em>";
    const head = Object.keys(rows[0]);
    const sample = rows.slice(0, max);
    const rowsHtml = sample
        .map(
            (r) =>
                `<tr>${head
                    .map(
                        (h) =>
                            `<td class="px-2 py-1 text-xs">${r[h] ?? ""}</td>`
                    )
                    .join("")}</tr>`
        )
        .join("");
    return `
    <div class="border border-gray-200 rounded">
        <div class="px-2 py-1 bg-gray-50 text-xs text-gray-600">Preview (${
            rows.length
        } rows)</div>
        <div class="overflow-x-auto">
            <table class="min-w-full text-xs">
            <thead class="bg-gray-100">
                <tr>${head
                    .map((h) => `<th class="px-2 py-1 text-left">${h}</th>`)
                    .join("")}</tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
            </table>
        </div>
    </div>`;
}

/* ----------------------------- Firestore-driven rules ----------------------------- */
// Build rules from /events docs: { [event_id]: {min,max,label,status} }
async function loadEventRules() {
    const snap = await getDocs(collection(db, "events"));
    const rules = {};
    snap.forEach((d) => {
        const ev = d.id;
        const data = d.data() || {};
        const max = Number(data.roster_max) || 1;
        const min = Number(data.roster_min ?? max); // default to max if not provided
        rules[ev] = {
            min,
            max,
            label: data.name || ev,
            status: data.status || "planning",
        };
    });
    return rules;
}

// Capacity = number of DISTINCT placeholder team IDs appearing in qualifiers
// for each event (works for badminton pools & basketball A1..D4 style).
async function loadEventCapacity() {
    const qSnap = await getDocs(
        query(collection(db, "matches"), where("match_type", "==", "qualifier"))
    );
    const acc = {}; // { eventId: { placeholders:Set, totalSlots:number } }
    qSnap.forEach((docSnap) => {
        const d = docSnap.data() || {};
        const ev = d.event_id;
        if (!ev) return;
        acc[ev] ??= { placeholders: new Set(), totalSlots: 0 };
        const a = d.competitor_a?.id;
        const b = d.competitor_b?.id;
        if (a) acc[ev].placeholders.add(a);
        if (b) acc[ev].placeholders.add(b);
    });
    Object.keys(acc).forEach((ev) => {
        acc[ev].totalSlots = acc[ev].placeholders.size;
    });
    return acc; // { ev: {placeholders:Set, totalSlots:Number} }
}

/* ----------------------------- validators ----------------------------- */
function validatePlayers(rows) {
    const errors = [];
    const warnings = [];
    const players = [];
    const seenEmail = new Set();

    rows.forEach((r, idx) => {
        const row = idx + 2;
        const full_name = norm.str(r.full_name);
        const email = norm.email(r.email);

        if (!full_name)
            errors.push(`Players.csv row ${row}: missing full_name`);
        if (!email) errors.push(`Players.csv row ${row}: missing email`);

        if (email && seenEmail.has(email))
            errors.push(`Players.csv row ${row}: duplicate email "${email}"`);
        seenEmail.add(email);

        const phone = norm.phone(r.phone);
        const accomodation = norm.str(r.accommodation || r.accomodation); // typos happen
        const meals = norm.str(r.meals);
        const is_guest = norm.str(r.is_guest || r.guest || "").toLowerCase();

        players.push({
            full_name,
            email,
            phone,
            accommodation: accomodation || null,
            meals: meals || null,
            is_guest: ["true", "yes", "y", "1"].includes(is_guest)
                ? true
                : false,
        });
    });

    const playersByEmail = {};
    players.forEach((p) => (playersByEmail[p.email] = p));
    return { errors, warnings, players, playersByEmail };
}

function validateTeams(rows, playersByEmail, capacityMap, rulesByEvent) {
    const errors = [];
    const warnings = [];
    const teams = [];
    const dupCheck = new Set(); // `${event_id}::${team_name}`

    rows.forEach((r, idx) => {
        const rowNum = idx + 2;
        const event_id = norm.str(r.event_id);
        const team_name = norm.str(r.team_name);
        const membersRaw = norm.str(r.member_emails);

        if (!event_id) errors.push(`Teams.csv row ${rowNum}: missing event_id`);
        if (!team_name)
            errors.push(`Teams.csv row ${rowNum}: missing team_name`);

        // duplicate name within same event
        const key = `${event_id}::${team_name.toLowerCase()}`;
        if (dupCheck.has(key)) {
            errors.push(
                `Teams.csv row ${rowNum}: duplicate team_name "${team_name}" in event "${event_id}"`
            );
        }
        dupCheck.add(key);

        const rule = rulesByEvent[event_id];
        if (!rule) {
            errors.push(
                `Teams.csv row ${rowNum}: unknown event_id "${event_id}" (no events/${event_id} doc)`
            );
        }

        const emails = uniq(
            membersRaw
                .split(";")
                .map((s) => norm.email(s))
                .filter(Boolean)
        );

        if (rule) {
            const need =
                rule.min === rule.max
                    ? `${rule.min}`
                    : `${rule.min}-${rule.max}`;
            if (emails.length < rule.min || emails.length > rule.max) {
                errors.push(
                    `Teams.csv row ${rowNum}: ${event_id} requires ${need} member(s), got ${emails.length}`
                );
            }
            if (rule.status && rule.status !== "planning") {
                warnings.push(
                    `Event "${event_id}" is status=${rule.status}; check before importing more teams.`
                );
            }
        }

        emails.forEach((e) => {
            if (!playersByEmail[e]) {
                errors.push(
                    `Teams.csv row ${rowNum}: member not found in Players: "${e}"`
                );
            }
        });

        teams.push({ event_id, team_name, member_emails: emails });
    });

    // capacity check
    const byEvent = {};
    teams.forEach((t) => {
        byEvent[t.event_id] ??= [];
        byEvent[t.event_id].push(t);
    });

    Object.entries(byEvent).forEach(([ev, arr]) => {
        const cap = capacityMap[ev];
        if (!cap) {
            warnings.push(
                `Capacity: no qualifier schedule found for "${ev}" — capacity check skipped`
            );
            return;
        }
        const needed = arr.length;
        const available = cap.totalSlots;
        if (needed > available) {
            errors.push(
                `Capacity for ${ev}: ${needed} teams submitted, but only ${available} slots exist in qualifiers`
            );
        } else if (needed < available) {
            warnings.push(
                `Capacity for ${ev}: ${available} slots exist, only ${needed} teams submitted`
            );
        }
    });

    return { errors, warnings, teams };
}

/* ----------------------------- wire UI ----------------------------- */
let playersRows = [];
let teamsRows = [];

async function handlePlayersFile(file) {
    try {
        const rows = await parseCsvFile(file);
        playersRows = rows;
        els.playersStatus.innerHTML = `
        <div class="text-green-700">
            <i class="fas fa-check-circle mr-2"></i>${file.name} — ${
            rows.length
        } rows
        </div>
        <div class="mt-2">${previewList(rows)}</div>
    `;
    } catch (e) {
        els.playersStatus.innerHTML = `
        <div class="text-red-700">
            <i class="fas fa-exclamation-triangle mr-2"></i>Failed to parse ${file.name}
        </div>`;
    } finally {
        els.btnValidate.disabled = !(playersRows.length && teamsRows.length);
    }
}

async function handleTeamsFile(file) {
    try {
        const rows = await parseCsvFile(file);
        teamsRows = rows;
        els.teamsStatus.innerHTML = `
        <div class="text-green-700">
            <i class="fas fa-check-circle mr-2"></i>${file.name} — ${
            rows.length
        } rows
        </div>
        <div class="mt-2">${previewList(rows)}</div>`;
    } catch (e) {
        els.teamsStatus.innerHTML = `
        <div class="text-red-700">
            <i class="fas fa-exclamation-triangle mr-2"></i>Failed to parse ${file.name}
        </div>`;
    } finally {
        els.btnValidate.disabled = !(playersRows.length && teamsRows.length);
    }
}

els.playersInput.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) handlePlayersFile(f);
});
els.teamsInput.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) handleTeamsFile(f);
});

/* ----------------------------- validate action ----------------------------- */
els.btnValidate.addEventListener("click", async () => {
    try {
        els.loading.classList.remove("hidden");
        setProgress(5);

        // Rules & capacity from Firestore
        const [capacityMap, eventRules] = await Promise.all([
            loadEventCapacity(),
            loadEventRules(),
        ]);
        setProgress(25);

        // Players
        const playersRes = validatePlayers(playersRows);
        setProgress(45);

        // Teams
        const teamsRes = validateTeams(
            teamsRows,
            playersRes.playersByEmail,
            capacityMap,
            eventRules
        );
        setProgress(70);

        // Summarize
        const allErrors = [...playersRes.errors, ...teamsRes.errors];
        const allWarnings = [...playersRes.warnings, ...teamsRes.warnings];

        const capacitySummary = Object.entries(capacityMap)
            .map(
                ([ev, info]) =>
                    `<li><code>${ev}</code>: ${info.totalSlots} qualifier slots</li>`
            )
            .join("");

        const ruleSummary = Object.entries(eventRules)
            .map(
                ([ev, r]) =>
                    `<li><code>${ev}</code>: roster ${r.min}${
                        r.max !== r.min ? "-" + r.max : ""
                    } (status=${r.status})</li>`
            )
            .join("");

        const errorHtml =
            allErrors.length > 0
                ? `<div class="bg-red-50 border border-red-200 rounded p-3 mb-2">
                        <div class="font-semibold text-red-800 mb-1"><i class="fas fa-times-circle mr-2"></i>${
                            allErrors.length
                        } error(s)</div>
                        <ul class="list-disc ml-5 text-red-700 text-sm">${allErrors
                            .map((e) => `<li>${e}</li>`)
                            .join("")}</ul>
                    </div>`
                : "";

        const warnHtml =
            allWarnings.length > 0
                ? `<div class="bg-yellow-50 border border-yellow-200 rounded p-3 mb-2">
                        <div class="font-semibold text-yellow-800 mb-1"><i class="fas fa-exclamation-triangle mr-2"></i>${
                            allWarnings.length
                        } warning(s)</div>
                        <ul class="list-disc ml-5 text-yellow-700 text-sm">${allWarnings
                            .map((w) => `<li>${w}</li>`)
                            .join("")}</ul>
                    </div>`
                : "";

        msg(`
        ${errorHtml}
        ${warnHtml}
        <div class="bg-gray-50 border border-gray-200 rounded p-3">
            <div class="font-semibold text-gray-800 mb-2"><i class="fas fa-list-ul mr-2"></i>Summary</div>
            <ul class="list-disc ml-5 text-gray-700 text-sm">
            <li>Players parsed: <strong>${
                playersRes.players.length
            }</strong></li>
            <li>Teams parsed: <strong>${teamsRes.teams.length}</strong></li>
            <li class="mt-2">Event roster rules:</li>
            <ul class="list-disc ml-6">${ruleSummary || "<li>–</li>"}</ul>
            <li class="mt-2">Qualifier capacity:</li>
            <ul class="list-disc ml-6">${capacitySummary || "<li>–</li>"}</ul>
            </ul>
        </div>
        ${
            allErrors.length === 0
                ? `<div class="mt-3 text-green-700"><i class="fas fa-check-circle mr-2"></i>Looks good! Next: hook up the writer to push Teams and Users.</div>`
                : `<div class="mt-3 text-red-700"><i class="fas fa-ban mr-2"></i>Fix the errors above and re-validate.</div>`
        }
    `);

        setProgress(100);
    } catch (err) {
        msg(
            `<div class="text-red-700"><i class="fas fa-exclamation-triangle mr-2"></i>Validation failed: ${
                err?.message || err
            }</div>`
        );
    } finally {
        setTimeout(() => {
            els.loading.classList.add("hidden");
            // Show completion state
            els.progressText.textContent = "Complete!";
            els.progressBar.classList.add("bg-green-500"); // Change color to green
        }, 400);
    }
});
