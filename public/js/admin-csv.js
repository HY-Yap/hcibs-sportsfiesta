// /js/admin-csv.js
// Admin — CSV import (players + teams) with validation against Firestore "events" + qualifier capacity.
// Includes: auto-slot proposal UI + shuffle/recompute + Commit Import (+ safe replace mode) + Danger Zone resets.

import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    where,
    setDoc,
    writeBatch,
    getCountFromServer,
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

    // Proposal / Import extras
    chkReplace: document.getElementById("chkReplace"),

    // Danger Zone
    dzEvents: document.getElementById("dzEvents"),
    btnResetTeams: document.getElementById("btnResetTeams"),
    btnResetMatches: document.getElementById("btnResetMatches"),
};

// Matches CSV DOM refs
els.matchesInput = document.getElementById("csvMatches");
els.matchesStatus = document.getElementById("matchesStatus");
els.btnValidateMatches = document.getElementById("btnValidateMatches");
els.btnImportMatches = document.getElementById("btnImportMatches");
els.chkReplaceMatches = document.getElementById("chkReplaceMatches");

els.matchesCsvStatus = document.getElementById("matchesCsvStatus");
els.matchesStatusMessages = document.getElementById("matchesStatusMessages");
els.progressMatchesWrap = document.getElementById("progressMatchesContainer");
els.progressMatchesBar = document.getElementById("progressMatchesBar");
els.progressMatchesText = document.getElementById("progressMatchesText");

async function refreshFirestoreCounts() {
    try {
        console.log("🔍 Refreshing Firestore counts...");

        // 🚀 Use getCountFromServer instead of getDocs
        const [usersCountSnap, teamsCountSnap] = await Promise.all([
            getCountFromServer(collection(db, "users")),
            getCountFromServer(collection(db, "teams")),
        ]);

        const usersCount = usersCountSnap.data().count;
        const teamsCount = teamsCountSnap.data().count;

        console.log("👥 Users count:", usersCount);
        console.log("🏆 Teams count:", teamsCount);

        els.playerCount.textContent = usersCount;
        els.teamCount.textContent = teamsCount;

        console.log("✅ Counts updated successfully");
    } catch (error) {
        console.error("❌ Error refreshing counts:", error);
        els.playerCount.textContent = "Error";
        els.teamCount.textContent = "Error";
    }
}

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Matches progress + messaging
function setMatchesProgress(pct) {
    els.progressMatchesWrap?.classList.remove("hidden");
    if (els.progressMatchesBar) els.progressMatchesBar.style.width = `${pct}%`;
    if (els.progressMatchesText)
        els.progressMatchesText.textContent = `${pct}%`;
}
function matchesMsg(html) {
    els.matchesCsvStatus?.classList.remove("hidden");
    if (els.matchesStatusMessages) els.matchesStatusMessages.innerHTML = html;
}

// Matches state
let matchesRows = [];
window.__matches_state = null;

// Allowed match types
const ALLOWED_TYPES = new Set([
    "qualifier",
    "redemption",
    "qf",
    "semi",
    "final",
    "bronze",
    "bonus",
]);

/* Batch chunking (safe for 500 op limit) */
async function commitInChunks(ops, chunkSize = 400) {
    for (let i = 0; i < ops.length; i += chunkSize) {
        const batch = writeBatch(db);
        const slice = ops.slice(i, i + chunkSize);
        slice.forEach((fn) => fn(batch));
        await batch.commit();
        // eslint-disable-next-line no-await-in-loop
        await sleep(30);
    }
}

/* ----------------------------- system status ----------------------------- */
(async function bootStatus() {
    try {
        const evSnap = await getDocs(collection(db, "events"));
        els.dbStatus.innerHTML =
            '<i class="fas fa-circle text-green-500 mr-1"></i> Connected';
        els.eventCount.textContent = evSnap.size;

        // populate Danger Zone event list (if present)
        if (els.dzEvents) {
            els.dzEvents.innerHTML = "";
            evSnap.forEach((d) => {
                const opt = document.createElement("option");
                const data = d.data() || {};
                opt.value = d.id;
                opt.textContent = data.name || d.id;
                els.dzEvents.appendChild(opt);
            });
        }
    } catch {
        els.dbStatus.innerHTML =
            '<i class="fas fa-circle text-red-500 mr-1"></i> Error';
    }

    try {
        await refreshFirestoreCounts();
    } catch {}

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

/* Reset awards: delete awards/{eventId} for selected events */
async function resetAwardsForEvents(events) {
    if (!events.length) return 0;
    const ops = [];
    for (const ev of events) {
        ops.push((batch) => batch.delete(doc(db, "awards", ev)));
    }
    await commitInChunks(ops);
    return ops.length; // number of delete ops queued
}

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
async function loadEventRules() {
    const snap = await getDocs(collection(db, "events"));
    const rules = {};
    snap.forEach((d) => {
        const ev = d.id;
        const data = d.data() || {};
        const max = Number(data.roster_max) || 1;
        const min = Number(data.roster_min ?? max);
        rules[ev] = {
            min,
            max,
            label: data.name || ev,
            status: data.status || "planning",
        };
    });
    return rules;
}

async function loadEventCapacity() {
    const qSnap = await getDocs(
        query(collection(db, "matches"), where("match_type", "==", "qualifier"))
    );
    const acc = {};
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
    return acc;
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
        const accomodation = norm.str(r.accommodation || r.accomodation);
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
    const dupCheck = new Set();

    rows.forEach((r, idx) => {
        const rowNum = idx + 2;
        const event_id = norm.str(r.event_id);
        const team_name = norm.str(r.team_name);
        const membersRaw = norm.str(r.member_emails);

        if (!event_id) errors.push(`Teams.csv row ${rowNum}: missing event_id`);
        if (!team_name)
            errors.push(`Teams.csv row ${rowNum}: missing team_name`);

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

function validateMatches(rows, rulesByEvent) {
    const errors = [];
    const warnings = [];
    const seenId = new Set();
    const placeholdersByEvent = {};
    const affectedEvents = new Set();
    const matches = [];

    rows.forEach((r, i) => {
        const row = i + 2;

        const id = norm.str(r.id);
        const event_id = norm.str(r.event_id);
        const match_type = norm.str(r.match_type).toLowerCase();
        const venue = norm.str(r.venue);
        const scheduled_at_raw = norm.str(r.scheduled_at);
        const pool = norm.str(r.pool);
        const a = norm.str(r.competitor_a);
        const b = norm.str(r.competitor_b);

        if (!id) errors.push(`Matches.csv row ${row}: missing id`);
        if (id && seenId.has(id))
            errors.push(`Matches.csv row ${row}: duplicate id "${id}"`);
        seenId.add(id);

        if (!event_id) errors.push(`Matches.csv row ${row}: missing event_id`);
        if (event_id && !rulesByEvent[event_id]) {
            errors.push(
                `Matches.csv row ${row}: unknown event_id "${event_id}" (no events/${event_id} doc)`
            );
        }
        if (!match_type)
            errors.push(`Matches.csv row ${row}: missing match_type`);
        if (match_type && !ALLOWED_TYPES.has(match_type)) {
            errors.push(
                `Matches.csv row ${row}: invalid match_type "${match_type}"`
            );
        }
        if (!venue)
            warnings.push(
                `Matches.csv row ${row}: empty venue (allowed, but recommended)`
            );

        if (!scheduled_at_raw) {
            errors.push(`Matches.csv row ${row}: missing scheduled_at`);
        }
        const when = new Date(scheduled_at_raw);
        if (scheduled_at_raw && isNaN(when.getTime())) {
            errors.push(
                `Matches.csv row ${row}: invalid scheduled_at "${scheduled_at_raw}" (use ISO like 2025-08-23T09:05:00Z)`
            );
        }

        if (match_type === "qualifier" && !pool) {
            errors.push(
                `Matches.csv row ${row}: qualifiers require pool (A/B/…)`
            );
        }

        if (event_id) {
            affectedEvents.add(event_id);
            placeholdersByEvent[event_id] ??= new Set();
            if (a) placeholdersByEvent[event_id].add(a);
            if (b) placeholdersByEvent[event_id].add(b);
        }

        matches.push({
            id,
            event_id,
            match_type,
            venue,
            scheduled_at: when,
            ...(pool ? { pool } : {}),
            competitor_a: a ? { id: a } : null,
            competitor_b: b ? { id: b } : null,
        });
    });

    return {
        errors,
        warnings,
        matches,
        placeholdersByEvent,
        affectedEvents: Array.from(affectedEvents),
    };
}

async function ensurePlaceholderTeams(placeholdersByEvent) {
    const ops = [];
    for (const [event_id, set] of Object.entries(placeholdersByEvent)) {
        for (const slot of set) {
            const docId = `${event_id}__${slot}`;
            ops.push((batch) =>
                batch.set(
                    doc(db, "teams", docId),
                    { event_id, name: slot },
                    { merge: true }
                )
            );
        }
    }
    if (ops.length) await commitInChunks(ops);
}

/* ----------------------------- proposal helpers ----------------------------- */
async function loadPlaceholdersByEvent() {
    const qSnap = await getDocs(
        query(collection(db, "matches"), where("match_type", "==", "qualifier"))
    );
    const byEvent = {};
    qSnap.forEach((d) => {
        const m = d.data();
        if (!m?.event_id) return;
        const A = m.competitor_a?.id;
        const B = m.competitor_b?.id;
        byEvent[m.event_id] ??= new Set();
        if (A) byEvent[m.event_id].add(A);
        if (B) byEvent[m.event_id].add(B);
    });

    const natSort = (a, b) => {
        const ax = a.match(/^([A-Z]+)(\d+)$/i),
            bx = b.match(/^([A-Z]+)(\d+)$/i);
        if (ax && bx && ax[1] !== bx[1]) return ax[1].localeCompare(bx[1]);
        if (ax && bx) return Number(ax[2]) - Number(bx[2]);
        return a.localeCompare(b);
    };

    const result = {};
    Object.entries(byEvent).forEach(([ev, set]) => {
        result[ev] = Array.from(set).sort(natSort);
    });
    return result;
}

function groupTeamsByEvent(teams) {
    const g = {};
    teams.forEach((t) => {
        g[t.event_id] ??= [];
        g[t.event_id].push(t);
    });
    return g;
}

// Deterministic proposal: alpha teams → snake slots per event
function proposeAssignments(
    teamsByEvent,
    slotsByEvent,
    { sort = "alpha" } = {}
) {
    const proposal = {};
    Object.entries(teamsByEvent).forEach(([ev, teams]) => {
        const slots = (slotsByEvent[ev] || []).slice();
        if (!slots.length) return;

        const orderedTeams =
            sort === "alpha"
                ? teams
                      .slice()
                      .sort((a, b) => a.team_name.localeCompare(b.team_name))
                : teams.slice();

        const snakeSlots = [];
        const chunk = 4;
        for (let i = 0; i < slots.length; i += chunk) {
            const seg = slots.slice(i, i + chunk);
            if ((i / chunk) % 2 === 1) seg.reverse();
            snakeSlots.push(...seg);
        }

        proposal[ev] = orderedTeams
            .map((t, i) => ({ ...t, slot: snakeSlots[i] || null }))
            .filter((x) => x.slot);
    });
    return proposal;
}

/* ----------------------------- proposal UI ----------------------------- */
function renderProposalTable(proposal, slotsByEvent) {
    const wrap = document.getElementById("proposalCard");
    const tbl = document.getElementById("proposalTable");
    if (!wrap || !tbl) return;
    wrap.classList.remove("hidden");

    const html = Object.keys(proposal)
        .sort()
        .map((ev) => {
            const rows = proposal[ev] || [];
            const allSlots = (slotsByEvent[ev] || []).slice();

            const optionsHtml = (sel) =>
                allSlots
                    .map(
                        (s) =>
                            `<option value="${s}" ${
                                s === sel ? "selected" : ""
                            }>${s}</option>`
                    )
                    .join("");

            const tr = rows
                .map(
                    (r, idx) => `
          <tr class="even:bg-gray-50">
            <td class="px-2 py-1 text-sm">${ev}</td>
            <td class="px-2 py-1 text-sm">${r.team_name}</td>
            <td class="px-2 py-1 text-xs text-gray-500">${r.member_emails.join(
                "; "
            )}</td>
            <td class="px-2 py-1">
              <select class="slotSel border rounded px-2 py-1 text-sm" data-ev="${ev}" data-idx="${idx}">
                ${optionsHtml(r.slot)}
              </select>
            </td>
          </tr>`
                )
                .join("");

            return `
        <div class="mb-6 border border-gray-200 rounded">
          <div class="px-3 py-2 bg-gray-50 text-sm font-semibold">${ev}</div>
          <div class="overflow-x-auto">
            <table class="min-w-full text-sm">
              <thead class="bg-gray-100">
                <tr>
                  <th class="px-2 py-1 text-left">Event</th>
                  <th class="px-2 py-1 text-left">Team</th>
                  <th class="px-2 py-1 text-left">Members</th>
                  <th class="px-2 py-1 text-left">Slot</th>
                </tr>
              </thead>
              <tbody>${tr}</tbody>
            </table>
          </div>
        </div>`;
        })
        .join("");

    tbl.innerHTML = html;

    const selects = Array.from(document.querySelectorAll(".slotSel"));
    const check = () => {
        const perEv = {};
        let ok = true;
        selects.forEach((s) => {
            const ev = s.dataset.ev;
            perEv[ev] ??= {};
            perEv[ev][s.value] = (perEv[ev][s.value] || 0) + 1;
        });
        selects.forEach((s) => {
            const ev = s.dataset.ev;
            if (perEv[ev][s.value] > 1) {
                s.classList.add("border-red-500");
                ok = false;
            } else {
                s.classList.remove("border-red-500");
            }
        });
        const btn = document.getElementById("btnImport");
        if (btn) btn.disabled = !ok;
    };
    selects.forEach((s) => s.addEventListener("change", check));
    check();
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
      <div class="mt-2">${previewList(rows)}</div>`;
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

async function handleMatchesFile(file) {
    try {
        const rows = await parseCsvFile(file);
        matchesRows = rows;
        els.matchesStatus.innerHTML = `
      <div class="text-green-700">
        <i class="fas fa-check-circle mr-2"></i>${file.name} — ${
            rows.length
        } rows
      </div>
      <div class="mt-2">${previewList(rows)}</div>`;
    } catch (e) {
        matchesRows = [];
        els.matchesStatus.innerHTML = `
      <div class="text-red-700">
        <i class="fas fa-exclamation-triangle mr-2"></i>Failed to parse ${file.name}
      </div>`;
    } finally {
        if (els.btnValidateMatches)
            els.btnValidateMatches.disabled = matchesRows.length === 0;
        if (els.btnImportMatches) els.btnImportMatches.disabled = true;
    }
}

els.matchesInput?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (f) handleMatchesFile(f);
});

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

        const [capacityMap, eventRules] = await Promise.all([
            loadEventCapacity(),
            loadEventRules(),
        ]);
        setProgress(25);

        const playersRes = validatePlayers(playersRows);
        setProgress(45);

        const teamsRes = validateTeams(
            teamsRows,
            playersRes.playersByEmail,
            capacityMap,
            eventRules
        );
        setProgress(70);

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
                <ul class="list-disc ml-6">${
                    capacitySummary || "<li>–</li>"
                }</ul>
                </ul>
            </div>`);

        if (allErrors.length === 0) {
            const slotsByEvent = await loadPlaceholdersByEvent();
            const owner = {};
            const clashes = [];
            for (const [ev, slots] of Object.entries(slotsByEvent)) {
                for (const s of slots) {
                    if (owner[s] && owner[s] !== ev)
                        clashes.push([s, owner[s], ev]);
                    owner[s] ||= ev;
                }
            }
            if (clashes.length) {
                const list = clashes
                    .map(
                        ([s, a, b]) =>
                            `<li><code>${s}</code> used by <code>${a}</code> and <code>${b}</code></li>`
                    )
                    .join("");
                msg(`
                <div class="bg-yellow-50 border border-yellow-200 rounded p-3 mb-2">
                <div class="font-semibold text-yellow-800 mb-1">
                    <i class="fas fa-exclamation-triangle mr-2"></i>
                    Qualifier slot IDs reused across events (this is OK with namespaced team docs)
                </div>
                <ul class="list-disc ml-5 text-yellow-700 text-sm">${list}</ul>
                </div>`);
                // NOTE: don't return; continue to build proposal
            }
            const teamsByEvent = groupTeamsByEvent(teamsRes.teams);

            window.__csv_state = {
                players: playersRes.players,
                teams: teamsRes.teams,
                teamsByEvent,
                slotsByEvent,
                proposal: null,
            };

            const proposal = proposeAssignments(teamsByEvent, slotsByEvent);
            window.__csv_state.proposal = proposal;

            renderProposalTable(proposal, slotsByEvent);
        } else {
            const card = document.getElementById("proposalCard");
            if (card) card.classList.add("hidden");
        }

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
            els.progressText.textContent = "Complete!";
            els.progressBar.classList.add("bg-green-500");
        }, 400);
    }
});

// Validate Matches CSV
els.btnValidateMatches?.addEventListener("click", async () => {
    try {
        els.loading.classList.remove("hidden");
        setMatchesProgress(5);

        const eventRules = await loadEventRules();
        setMatchesProgress(25);

        const res = validateMatches(matchesRows, eventRules);
        setMatchesProgress(60);

        const errorHtml = res.errors.length
            ? `<div class="bg-red-50 border border-red-200 rounded p-3 mb-2">
           <div class="font-semibold text-red-800 mb-1"><i class="fas fa-times-circle mr-2"></i>${
               res.errors.length
           } error(s)</div>
           <ul class="list-disc ml-5 text-red-700 text-sm">${res.errors
               .map((e) => `<li>${e}</li>`)
               .join("")}</ul>
         </div>`
            : "";

        const warnHtml = res.warnings.length
            ? `<div class="bg-yellow-50 border border-yellow-200 rounded p-3 mb-2">
           <div class="font-semibold text-yellow-800 mb-1"><i class="fas fa-exclamation-triangle mr-2"></i>${
               res.warnings.length
           } warning(s)</div>
           <ul class="list-disc ml-5 text-yellow-700 text-sm">${res.warnings
               .map((w) => `<li>${w}</li>`)
               .join("")}</ul>
         </div>`
            : "";

        const perEvent = res.matches.reduce((acc, m) => {
            acc[m.event_id] = (acc[m.event_id] || 0) + 1;
            return acc;
        }, {});
        const perEventHtml = Object.entries(perEvent)
            .map(([ev, n]) => `<li><code>${ev}</code>: ${n} matches</li>`)
            .join("");

        matchesMsg(`
      ${errorHtml}${warnHtml}
      <div class="bg-gray-50 border border-gray-200 rounded p-3">
        <div class="font-semibold text-gray-800 mb-2"><i class="fas fa-list-ul mr-2"></i>Summary</div>
        <ul class="list-disc ml-5 text-gray-700 text-sm">
          <li>Rows parsed: <strong>${res.matches.length}</strong></li>
          <li class="mt-2">Affected events:</li>
          <ul class="list-disc ml-6">${perEventHtml || "<li>–</li>"}</ul>
        </ul>
      </div>
    `);

        if (res.errors.length === 0) {
            window.__matches_state = res;
            els.btnImportMatches.disabled = false;
        } else {
            window.__matches_state = null;
            els.btnImportMatches.disabled = true;
        }

        setMatchesProgress(100);
    } catch (err) {
        matchesMsg(
            `<div class="text-red-700"><i class="fas fa-exclamation-triangle mr-2"></i>Validation failed: ${
                err?.message || err
            }</div>`
        );
    } finally {
        setTimeout(() => {
            els.loading.classList.add("hidden");
            els.progressMatchesText.textContent = "Complete!";
            els.progressMatchesBar.classList.add("bg-green-500");
        }, 400);
    }
});

// Import Matches
els.btnImportMatches?.addEventListener("click", async () => {
    const S = window.__matches_state;
    if (!S) return;

    try {
        els.btnImportMatches.disabled = true;
        els.btnImportMatches.textContent = "Importing…";
        setMatchesProgress(5);

        const replace = !!(
            els.chkReplaceMatches && els.chkReplaceMatches.checked
        );
        const affected = S.affectedEvents || [];

        if (replace && affected.length) {
            const delOps = [];
            for (const ev of affected) {
                const snap = await getDocs(
                    query(
                        collection(db, "matches"),
                        where("event_id", "==", ev)
                    )
                );
                snap.forEach((d) =>
                    delOps.push((batch) => batch.delete(d.ref))
                );
            }
            if (delOps.length) await commitInChunks(delOps);
        }
        setMatchesProgress(40);

        await ensurePlaceholderTeams(S.placeholdersByEvent);
        setMatchesProgress(65);

        const writeOps = S.matches.map((m) => (batch) => {
            const payload = {
                event_id: m.event_id,
                competitor_a: m.competitor_a || null,
                competitor_b: m.competitor_b || null,
                score_a: null,
                score_b: null,
                status: "scheduled",
                venue: m.venue || null,
                scheduled_at: m.scheduled_at,
                match_type: m.match_type,
                ...(m.pool ? { pool: m.pool } : {}),
            };
            batch.set(doc(db, "matches", m.id), payload, { merge: true });
        });
        if (writeOps.length) await commitInChunks(writeOps, 400);

        setMatchesProgress(100);
        alert("✅ Matches imported successfully.");
        await refreshFirestoreCounts();
    } catch (err) {
        console.error(err);
        alert(`❌ Import failed: ${err?.message || err}`);
    } finally {
        els.btnImportMatches.disabled = false;
        els.btnImportMatches.textContent = "Import Matches";
    }
});

/* ----------------------------- proposal actions ----------------------------- */
document.addEventListener("click", (e) => {
    if (e.target.closest("#btnShuffle")) {
        const S = window.__csv_state;
        if (!S) return;
        const shuffled = {};
        Object.entries(S.teamsByEvent).forEach(([ev, arr]) => {
            const a = arr.slice();
            for (let i = a.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [a[i], a[j]] = [a[j], a[i]];
            }
            shuffled[ev] = a;
        });
        const prop = proposeAssignments(shuffled, S.slotsByEvent, {
            sort: "as-is",
        });
        S.proposal = prop;
        renderProposalTable(prop, S.slotsByEvent);
    }
});

document.addEventListener("click", (e) => {
    if (e.target.closest("#btnRecompute")) {
        const S = window.__csv_state;
        if (!S) return;
        const prop = proposeAssignments(S.teamsByEvent, S.slotsByEvent, {
            sort: "alpha",
        });
        S.proposal = prop;
        renderProposalTable(prop, S.slotsByEvent);
    }
});

/* Commit Import → write teams/{slot} (safe replace mode) */
document.addEventListener("click", async (e) => {
    if (!e.target.closest("#btnImport")) return;

    const btn = document.getElementById("btnImport");
    const S = window.__csv_state;
    if (!S?.proposal) return;

    // Read current selections from the table
    const selects = Array.from(document.querySelectorAll(".slotSel"));
    const byEvent = {};
    selects.forEach((sel) => {
        const ev = sel.dataset.ev;
        const idx = Number(sel.dataset.idx);
        byEvent[ev] ??= [];
        byEvent[ev][idx] = sel.value;
    });

    // Build flat list: {event_id, team_name, member_emails, slot}
    const rows = [];
    Object.entries(S.proposal).forEach(([ev, arr]) => {
        arr.forEach((r, idx) => {
            rows.push({
                event_id: ev,
                team_name: r.team_name,
                member_emails: r.member_emails,
                slot: byEvent[ev]?.[idx] || r.slot,
            });
        });
    });

    // Final uniqueness check per event
    const perEventPick = {};
    let dupErr = null;
    rows.forEach((r) => {
        perEventPick[r.event_id] ??= new Set();
        if (perEventPick[r.event_id].has(r.slot))
            dupErr = `${r.event_id} duplicate slot ${r.slot}`;
        perEventPick[r.event_id].add(r.slot);
    });
    if (dupErr) {
        alert(`Duplicate slot chosen: ${dupErr}`);
        return;
    }

    try {
        btn.disabled = true;
        btn.textContent = "Importing…";

        const replace = !!(els.chkReplace && els.chkReplace.checked);
        const affectedEvents = Object.keys(S.proposal);

        if (replace) {
            const delOps = [];
            for (const ev of affectedEvents) {
                const snap = await getDocs(
                    query(collection(db, "teams"), where("event_id", "==", ev))
                );
                snap.forEach((d) =>
                    delOps.push((batch) => batch.delete(d.ref))
                );
            }
            if (delOps.length) await commitInChunks(delOps);
        }

        // Write/overwrite selected slots
        const writeOps = rows.map((r) => (batch) => {
            // 🔥 Use event-scoped doc ID
            const docId = `${r.event_id}__${r.slot}`;
            return batch.set(
                doc(db, "teams", docId),
                {
                    event_id: r.event_id,
                    name: r.team_name,
                    member_emails: r.member_emails,
                },
                { merge: true }
            );
        });
        if (writeOps.length) await commitInChunks(writeOps);

        alert("✅ Import complete! Placeholders now show real team names.");
        await refreshFirestoreCounts();
    } catch (err) {
        console.error(err);
        alert(`❌ Import failed: ${err?.message || err}`);
    } finally {
        btn.disabled = false;
        btn.textContent = "Commit Import to Firestore";
    }
});

/* ----------------------------- Danger Zone helpers ----------------------------- */
function getSelectedEvents() {
    if (!els.dzEvents) return [];
    return Array.from(els.dzEvents.selectedOptions || []).map(
        (opt) => opt.value
    );
}

/* Reset teams → delete teams docs for selected events */
async function resetTeamsForEvents(events) {
    if (!events.length) return 0;
    const ops = [];
    for (const ev of events) {
        // 🔥 Query both old format and new format
        const snap = await getDocs(
            query(collection(db, "teams"), where("event_id", "==", ev))
        );
        snap.forEach((d) => ops.push((batch) => batch.delete(d.ref)));
    }
    await commitInChunks(ops);
    return ops.length;
}

/* Compute default elim placeholders based on match id + event */
function defaultParticipantsFor(eventId, matchId) {
    // Basketball 3v3
    if (eventId === "basketball3v3") {
        if (/^B-QF1$/.test(matchId)) return ["BW1", "BW8"];
        if (/^B-QF2$/.test(matchId)) return ["BW2", "BW7"];
        if (/^B-QF3$/.test(matchId)) return ["BW3", "BW6"];
        if (/^B-QF4$/.test(matchId)) return ["BW4", "BW5"];
        if (/^B-SF1$/.test(matchId)) return ["BQF1W", "BQF2W"];
        if (/^B-SF2$/.test(matchId)) return ["BQF3W", "BQF4W"];
        if (/^B-F1$/.test(matchId)) return ["BSF1W", "BSF2W"];
        if (/^B-B1$/.test(matchId)) return ["BSF1L", "BSF2L"];
        return null;
    }

    // Badminton Singles
    if (eventId === "badminton_singles") {
        const sf = matchId.match(/^S-SF([12])-\d$/);
        if (sf) return sf[1] === "1" ? ["S1", "S4"] : ["S2", "S3"];
        if (/^S-F\d$/.test(matchId)) return ["SFW1", "SFW2"];
        if (/^S-B\d$/.test(matchId)) return ["SBW1", "SBW2"];
        return null;
    }

    // Badminton Doubles
    if (eventId === "badminton_doubles") {
        const sf = matchId.match(/^D-SF([12])-\d$/);
        if (sf) return sf[1] === "1" ? ["D1", "D4"] : ["D2", "D3"];
        if (/^D-F\d$/.test(matchId)) return ["DFW1", "DFW2"];
        if (/^D-B\d$/.test(matchId)) return ["DBW1", "DBW2"];
        return null;
    }

    // Frisbee 5v5
    if (eventId === "frisbee5v5") {
        if (/^F-R1$/.test(matchId)) return ["A3", "B3"];
        if (/^F-R2$/.test(matchId)) return ["C3", "A4"];
        if (/^F-QF1$/.test(matchId)) return ["A1", "B2"];
        if (/^F-QF2$/.test(matchId)) return ["B1", "A2"];
        if (/^F-QF3$/.test(matchId)) return ["C1", "FR1W"];
        if (/^F-QF4$/.test(matchId)) return ["C2", "FR2W"];
        if (/^F-SF1$/.test(matchId)) return ["BQF1W", "BQF3W"];
        if (/^F-SF2$/.test(matchId)) return ["BQF2W", "BQF4W"];
        if (/^F-F1$/.test(matchId)) return ["FSF1W", "FSF2W"];
        if (/^F-B1$/.test(matchId)) return ["FSF1L", "FSF2L"];
        if (/^F-BON1$/.test(matchId)) return ["FCHAMP", "IBP"];
        return null;
    }

    return null;
}

/* Reset matches: clear scores, set scheduled, restore elim placeholders where known */
async function resetMatchesForEvents(events) {
    if (!events.length) return { updated: 0 };

    let updated = 0;
    for (const ev of events) {
        const snap = await getDocs(
            query(collection(db, "matches"), where("event_id", "==", ev))
        );

        const ops = [];
        snap.forEach((d) => {
            const m = d.data() || {};
            const id = d.id;

            const base = {
                score_a: null,
                score_b: null,
            };
            if (m.status !== "void") base.status = "scheduled";

            let comp = {};
            if (m.match_type && m.match_type !== "qualifier") {
                const ab = defaultParticipantsFor(ev, id);
                if (ab) {
                    comp = {
                        competitor_a: ab[0] ? { id: ab[0] } : null,
                        competitor_b: ab[1] ? { id: ab[1] } : null,
                    };
                }
            }

            ops.push((batch) => batch.update(d.ref, { ...base, ...comp }));
            updated += 1;
        });

        if (ops.length) await commitInChunks(ops);
    }

    return { updated };
}

// Add this helper function for team name resolution
async function resolveTeamName(eventId, competitorId) {
    if (!competitorId) return competitorId;

    try {
        // Try namespaced first (new format)
        const namespacedId = `${eventId}__${competitorId}`;
        let snap = await getDoc(doc(db, "teams", namespacedId));

        // Fall back to legacy format
        if (!snap.exists()) {
            snap = await getDoc(doc(db, "teams", competitorId));
        }

        if (snap.exists()) {
            const data = snap.data();
            return data.name || competitorId;
        }
    } catch (error) {
        console.warn(`Failed to resolve team name for ${competitorId}:`, error);
    }

    return competitorId; // Return original ID if resolution fails
}

/* ----------------------------- Danger Zone actions ----------------------------- */
if (els.btnResetTeams) {
    els.btnResetTeams.addEventListener("click", async () => {
        const events = getSelectedEvents();
        if (!events.length) {
            alert("Select at least one event.");
            return;
        }
        const ok = confirm(
            `Delete all teams mapped for: ${events.join(
                ", "
            )}?\nThis will remove docs in 'teams' with these event_id(s).`
        );
        if (!ok) return;

        try {
            els.btnResetTeams.disabled = true;
            const count = await resetTeamsForEvents(events);
            await refreshFirestoreCounts();
            alert(
                `✅ Deleted ${count} team doc(s) across ${events.length} event(s).`
            );
        } catch (e) {
            console.error(e);
            alert(`❌ Reset failed: ${e?.message || e}`);
        } finally {
            els.btnResetTeams.disabled = false;
        }
    });
}

if (els.btnResetMatches) {
    els.btnResetMatches.addEventListener("click", async () => {
        const events = getSelectedEvents();
        if (!events.length) {
            alert("Select at least one event.");
            return;
        }
        const ok = confirm(
            `Reset matches (clear scores, set scheduled, reapply elim placeholders) ` +
                `AND clear awards for: ${events.join(", ")}?\n` +
                `Qualifiers keep their original A1/B2/etc from your schedule. ` +
                `Awards docs will be removed and republished automatically when finals conclude.`
        );
        if (!ok) return;

        try {
            els.btnResetMatches.disabled = true;

            // 1) matches → scheduled + placeholders restored
            const { updated } = await resetMatchesForEvents(events);

            // 2) awards → delete awards/{eventId}
            const awardsCleared = await resetAwardsForEvents(events);

            alert(
                `✅ Reset ${updated} match doc(s) and cleared ${awardsCleared} awards doc(s)` +
                    ` across ${events.length} event(s).`
            );
        } catch (e) {
            console.error(e);
            alert(`❌ Reset failed: ${e?.message || e}`);
        } finally {
            els.btnResetMatches.disabled = false;
        }
    });
}

/* ----------------------------- Clear button extras ----------------------------- */
els.btnClear.addEventListener("click", () => {
    document.getElementById("csvPlayers").value = "";
    document.getElementById("csvTeams").value = "";
    document.getElementById("playersStatus").innerHTML = "";
    document.getElementById("teamsStatus").innerHTML = "";
    document.getElementById("csvStatus").classList.add("hidden");
    document.getElementById("btnValidate").disabled = true;

    document.getElementById("progressContainer").classList.add("hidden");
    document.getElementById("progressBar").style.width = "0%";
    document.getElementById("progressText").textContent = "0%";
    document.getElementById("progressBar").classList.remove("bg-green-500");

    const card = document.getElementById("proposalCard");
    if (card) card.classList.add("hidden");
    window.__csv_state = null;
});
