/*  public/js/scorekeeper.js  (v 8)
    ----------------------------------------------------------------
    + Smart match filtering: shows upcoming/live matches, hides finished
    + Progressive reveal: only shows matches when competitors are confirmed
    + Auto-refresh: updates match list without page reload
    + Event selector → filters the match list
    + remembers last event & match in sessionStorage
    + keeps all previous features (swap-sides lock, live sync, …)
------------------------------------------------------------------ */

import {
    collection,
    query,
    where,
    orderBy,
    getDocs,
    doc,
    onSnapshot,
    updateDoc,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const { db, auth } = window.firebase;

/* ───── quick DOM ───── */
const $ = (id) => document.getElementById(id);
const msg = $("msg");
const evt = $("eventSelect");
const sel = $("matchSelect");
const load = $("loadBtn");
const pane = $("panel");
const label = $("matchLabel");
const redT = $("redTeam");
const blueT = $("blueTeam");
const sA = $("scoreA");
const sB = $("scoreB");
const timer = $("timer");
const pauseBtn = $("pauseBtn");
const start = $("startBtn");
const end = $("endBtn");

/* state */
let docRef = null; // current match doc ref
let unsubLive = null; // listener to that doc
let unsubMatchList = null; // listener to match list
let interval = null; // countdown ticker
let flipped = false; // UI orientation
let origRed = "",
    origBlue = "";
let remainingSeconds = 0; // track remaining time
let awaitingOvertime = false; // prevent double prompt
let usedOvertime = false; // disallow >1 overtime
let paused = false; // pause state

/* helpers */
const pad = (n) => String(n).padStart(2, "0");
const fmt = (ts) =>
    `${ts.toDate().toLocaleDateString("en", {
        weekday: "short",
        day: "2-digit",
        month: "short",
    })} ` + `${pad(ts.toDate().getHours())}:${pad(ts.toDate().getMinutes())}`;
const err = (t) => {
    msg.textContent = t;
    msg.classList.remove("hidden");
};

// Placeholder -> team name
let teamNameCache = new Map();

async function resolveTeamName(eventId, teamId) {
    if (!teamId) return "TBD";

    // Check cache first
    const cacheKey = `${eventId}__${teamId}`;
    if (teamNameCache.has(cacheKey)) {
        return teamNameCache.get(cacheKey);
    }

    try {
        // Try to find team document
        const teamDocId = `${eventId}__${teamId}`;
        const teamSnap = await getDocs(
            query(collection(db, "teams"), where("__name__", "==", teamDocId))
        );

        if (!teamSnap.empty) {
            const teamData = teamSnap.docs[0].data();
            const displayName = teamData.name || teamId;
            teamNameCache.set(cacheKey, displayName);
            return displayName;
        }

        // If no team document found, return the ID (for pool teams like A1, B2)
        teamNameCache.set(cacheKey, teamId);
        return teamId;
    } catch (error) {
        console.warn(`Could not resolve team name for ${teamId}:`, error);
        return teamId;
    }
}

/* ───── per-event default durations (seconds) ─────
   Requirements:
   - basketball: 8 mins (qualifiers), 15 mins (semifinals/finals)
   - badminton: 10 mins (qualifiers/elims/bronze), 15 mins each final game (F1/F2/F3)
   - frisbee: 10 mins standard, 20 mins final (F-F1)
*/
function defaultDurationSeconds(match) {
    const eventId = match.event_id || "";
    const type = match.match_type;
    // Basketball 3v3: 15 min for knockout stages, 8 min for qualifiers
    if (eventId === "basketball3v3") {
        if (
            type === "bronze" ||
            type === "semi" ||
            type === "final"
        ) {
            return 15 * 60;
        }
        return 8 * 60;
    }
    // Frisbee: finals 20, others 10
    if (eventId === "frisbee5v5") {
        return type === "final" ? 20 * 60 : 10 * 60;
    }
    // Badminton singles & doubles: finals 15, others 10
    if (eventId.startsWith("badminton")) {
        return type === "final" ? 15 * 60 : 10 * 60;
    }
    // Generic fallback
    return 10 * 60;
}

/* ───── progressive reveal helpers ───── */

// --- helpers used by deps/visibility
function statusOf(id, all) {
    return all.find((m) => m.id === id)?.status;
}
function allQualsFinal(eventId, all) {
    const quals = all.filter(
        (m) => m.event_id === eventId && m.match_type === "qualifier"
    );
    return quals.length > 0 && quals.every((m) => m.status === "final");
}

/* progressive reveal helpers */
function isPlaceholder(teamId, match) {
    if (!teamId) return true;

    // Badminton finals/bronze placeholders: SFW1, SBW2, DFW1, DBW2
    if (/^(?:S|D)[FB]W\d+$/.test(teamId)) return true;

    // Basketball QF seeding placeholders: BW1..BW8
    if (/^BW[1-8]$/.test(teamId)) return true;

    // Basketball progression placeholders: BQF1W, BQF2W, BSF1W, BSF2L
    if (/^B(?:QF[1-4]W|SF[12][WL])$/.test(teamId)) return true;

    // Badminton semi placeholders S1..S4 / D1..D4
    if (/^(?:S|D)[1-4]$/.test(teamId)) return true;

    // Frisbee placeholders used in elims - UPDATE THESE PATTERNS
    if (/^F(?:R[12]W|QF[1-4]W|SF[12][WL]|CHAMP)$/.test(teamId)) return true;

    // Only treat A1..C4 as placeholders for *frisbee elims*, not for basketball
    if (
        match?.event_id === "frisbee5v5" &&
        match?.match_type !== "qualifier" &&
        /^[ABC][1-4]$/.test(teamId)
    ) {
        return true;
    }

    return false;
}

function depsSatisfied(match, all) {
    const statusOf = (id) => all.find((m) => m.id === id)?.status;

    // ── Basketball ── (2 groups A/B, top 2 from each go to semis)
    if (match.event_id === "basketball3v3") {
        // Semis need all qualifiers to be final
        if (/^B-SF[12]$/.test(match.id)) {
            return allQualsFinal("basketball3v3", all);
        }
        if (/^B-(F1|B1)$/.test(match.id)) {
            return ["B-SF1", "B-SF2"].every((x) => statusOf(x) === "final");
        }
    }

    // ── Badminton BO3: only show F2/F3 or B2/B3 after game 1 has started ──
    if (/^[SD]-(F|B)[23]$/.test(match.id)) {
        const opener = match.id.replace(/[23]$/, "1");
        const st = statusOf(opener);
        return st === "live" || st === "final";
    }

    // ── Badminton series games (SF1-2, SF1-3, etc.) ──
    if (/^[SD]-SF\d+-[23]$/.test(match.id)) {
        const opener = match.id.replace(/-[23]$/, "-1");
        const st = statusOf(opener);
        return st === "live" || st === "final";
    }

    // ── Badminton Semis ── (need all qualifiers done)
    if (/^[SD]-SF\d+-\d$/.test(match.id)) {
        const eventId = match.event_id;
        return allQualsFinal(eventId, all);
    }

    // ── Frisbee ── (1 group of 7, single round robin, top 4 advance)
    if (match.event_id === "frisbee5v5") {
        const qualsDone = all
            .filter(
                (m) =>
                    m.event_id === "frisbee5v5" && m.match_type === "qualifier"
            )
            .every((m) => m.status === "final");

        // Bronze/Final need all qualifiers done (direct from round robin standings)
        if (/^F-(?:F1|B1)$/.test(match.id)) return qualsDone;

        // Bonus waits for Final
        if (match.id === "F-BON1") return statusOf("F-F1") === "final";
    }

    return true;
}

function shouldShowMatch(match, allMatches) {
    const { competitor_a, competitor_b, match_type, status } = match;

    // Robust qualifier test
    const isQualifierById = /-(?:Q)\d+$/.test(match.id);
    const isQualifier = match_type === "qualifier" || isQualifierById;

    // Qualifiers: only show while not finished
    if (isQualifier) return status !== "final";

    // Don't show voided matches
    if (status === "void") return false;

    // HIDE FINISHED ELIMINATION MATCHES (scorekeeper only)
    if (!isQualifier && status === "final") return false;

    // Progressive dependency gate
    if (!depsSatisfied(match, allMatches)) return false;

    // For Frisbee/Basketball elims: show once deps are met
    if (
        (match.event_id === "frisbee5v5" ||
            match.event_id === "basketball3v3") &&
        !isQualifier
    ) {
        return true; // deps already gated above
    }

    // Otherwise require real teams or started matches
    const bothConfirmed =
        !isPlaceholder(competitor_a?.id, match) &&
        !isPlaceholder(competitor_b?.id, match);
    const hasStarted = status === "live" || status === "final";
    return bothConfirmed || hasStarted;
}

function shouldShowGame3(matchId, allMatches) {
    // Only badminton series game 3: S/D finals/bronze or semis
    const isSeriesGame3 =
        /^[SD]-(F|B)3$/.test(matchId) || // S-F3, D-B3
        /^[SD]-SF\d+-3$/.test(matchId); // S-SF1-3, D-SF2-3

    if (!isSeriesGame3) return true;

    // Find series root
    const seriesRoot = matchId.includes("-SF")
        ? matchId.replace(/-\d+$/, "") // S-SF1-3 → S-SF1
        : matchId.replace(/\d+$/, ""); // S-F3 → S-F

    const seriesGames = allMatches.filter(
        (m) =>
            m.id.startsWith(seriesRoot) &&
            m.status === "final" &&
            !m.id.endsWith("3")
    );

    if (seriesGames.length < 2) return false;

    const winCounts = {};
    seriesGames.forEach((g) => {
        if (g.score_a > g.score_b)
            winCounts[g.competitor_a.id] =
                (winCounts[g.competitor_a.id] || 0) + 1;
        else if (g.score_b > g.score_a)
            winCounts[g.competitor_b.id] =
                (winCounts[g.competitor_b.id] || 0) + 1;
    });

    const wins = Object.values(winCounts);
    return wins.length === 2 && wins.every((w) => w === 1); // only show if 1–1
}

function getMatchPriority(matchId) {
    // Check most specific patterns first to avoid conflicts
    if (matchId.includes("-BON")) return 7; // Bonus (must be before -B)
    if (matchId.includes("-QF")) return 3; // Quarterfinals (must be before -Q)
    if (matchId.includes("-SF")) return 4; // Semifinals
    if (matchId.includes("-Q")) return 1; // Qualifiers
    if (matchId.includes("-R")) return 2; // Redemption
    if (matchId.includes("-B")) return 5; // Bronze
    if (matchId.includes("-F")) return 6; // Finals

    return 8; // Anything else
}

function getMatchStatus(match) {
    if (match.status === "live") return "🔴 LIVE";
    if (match.status === "scheduled") return "⏰ Upcoming";
    return match.status;
}

/* ───── auth gate ───── */
onAuthStateChanged(auth, async (user) => {
    if (!user) return err("Please log in.");
    try {
        // Force refresh to ensure newly set custom claims propagate
        const token = await user.getIdTokenResult(true);
        let role = token.claims.role;
        // Fallback: read Firestore user doc if custom claim not present yet
        if (!role) {
            try {
                const snap = await getDocs(
                    query(collection(db, "users"), where("uid", "==", user.uid))
                );
                // If users collection documents keyed by UID instead, try direct get
                if (snap.empty) {
                    const direct = await getDocs(collection(db, "users"));
                    direct.forEach((d) => {
                        if (d.id === user.uid && !role) role = d.data().role;
                    });
                } else {
                    snap.forEach((d) => {
                        if (!role) role = d.data().role;
                    });
                }
            } catch (_) {
                /* ignore */
            }
        }
        if (!role) {
            // Try direct doc by id if schema is users/{uid}
            try {
                const directDoc = await getDocs(collection(db, "users"));
                directDoc.forEach((d) => {
                    if (d.id === user.uid && !role) role = d.data().role;
                });
            } catch (_) {
                /* ignore */
            }
        }
        if (role !== "scorekeeper" && role !== "admin") {
            return err("Not a scorekeeper account.");
        }
        await populateEventDropdown();
        resumeIfAny();
    } catch (e) {
        console.warn("Role check failed", e);
        return err("Unable to verify scorekeeper role.");
    }
});

/* ───── 1. populate Event dropdown ───── */
async function populateEventDropdown() {
    const snap = await getDocs(collection(db, "events"));
    snap.docs
        .map((d) => d.id)
        .sort()
        .forEach((id) => {
            evt.insertAdjacentHTML(
                "beforeend",
                `<option value="${id}">${id.replace(/_/g, " ")}</option>`
            );
        });
}

/* ───── 2. rebuild Match dropdown with live updates ───── */
async function refreshMatchDropdown(eventId) {
    // Clean up previous listener
    if (unsubMatchList) {
        unsubMatchList();
        unsubMatchList = null;
    }

    sel.innerHTML = "";
    load.disabled = true;
    hidePanel();

    if (!eventId) return;

    // Set up live listener for matches
    const q = query(
        collection(db, "matches"),
        where("event_id", "==", eventId),
        orderBy("scheduled_at")
    );

    unsubMatchList = onSnapshot(q, (snap) => {
        (async () => {
            const allMatches = snap.docs.map((d) => ({
                id: d.id,
                ...d.data(),
            }));
            // Get current user and role
            let user = window.firebase.auth.currentUser;
            let role = "scorekeeper";
            if (user) {
                const token =
                    user.getIdTokenResult && (await user.getIdTokenResult());
                if (token && token.claims && token.claims.role) {
                    role = token.claims.role;
                }
            }
            // Filter matches to show
            const visibleMatches = allMatches.filter((match) => {
                // Scorekeeper: only show matches they are assigned to
                if (role === "scorekeeper") {
                    if (!user) return false;

                    // NEW: accept assignment via scorekeeper_email (plus legacy fields)
                    const userEmail = user.email ? user.email.toLowerCase() : null;
                    const matchEmail = match.scorekeeper_email
                        ? String(match.scorekeeper_email).toLowerCase()
                        : null;
                    const legacyEmail =
                        typeof match.scorekeeper === "string" &&
                        match.scorekeeper.includes("@")
                            ? match.scorekeeper.toLowerCase()
                            : null;

                    const emailMatch =
                        (!!matchEmail && !!userEmail && matchEmail === userEmail) ||
                        (!!legacyEmail && !!userEmail && legacyEmail === userEmail);

                    const uidMatch =
                        match.scorekeeper_uid === user.uid || match.scorekeeper === user.uid;

                    // If no assignment fields exist, hide
                    if (
                        !match.scorekeeper_email &&
                        !match.scorekeeper &&
                        !match.scorekeeper_uid
                    )
                        return false;

                    if (!emailMatch && !uidMatch) return false;
                }
                // Basic visibility check
                if (!shouldShowMatch(match, allMatches)) return false;
                // Special handling for game 3
                if (
                    /^[SD]-(?:F|B)3$/.test(match.id) ||
                    /^[SD]-SF\d+-3$/.test(match.id)
                ) {
                    return shouldShowGame3(match.id, allMatches);
                }
                return true;
            });
            // Sort matches: Live first, then by priority, then by time, then by number
            const sortedMatches = visibleMatches.sort((a, b) => {
                if (a.status === "live" && b.status !== "live") return -1;
                if (b.status === "live" && a.status !== "live") return 1;
                const aPriority = getMatchPriority(a.id);
                const bPriority = getMatchPriority(b.id);
                if (aPriority !== bPriority) return aPriority - bPriority;
                const aTime = a.scheduled_at.toMillis();
                const bTime = b.scheduled_at.toMillis();
                if (aTime !== bTime) return aTime - bTime;
                const aMatch = extractMatchNumber(a.id);
                const bMatch = extractMatchNumber(b.id);
                return aMatch - bMatch;
            });
            // Remember current selection
            const currentSelection = sel.value;
            sel.innerHTML = "";
            if (sortedMatches.length === 0) {
                sel.insertAdjacentHTML(
                    "beforeend",
                    `<option value="">No matches available</option>`
                );
                load.disabled = true;
                return;
            }
            const matchOptions = await Promise.all(
                sortedMatches.map(async (match) => {
                    const statusIcon = getMatchStatus(match);

                    // Resolve team names
                    const teamAName = await resolveTeamName(
                        match.event_id,
                        match.competitor_a?.id
                    );
                    const teamBName = await resolveTeamName(
                        match.event_id,
                        match.competitor_b?.id
                    );

                    const full = `${statusIcon} ${match.id} – ${fmt(
                        match.scheduled_at
                    )} – ${match.venue} (${teamAName} vs ${teamBName})`;
                    const label = truncateForMobile(full);

                    return `<option value="${match.id}">${label}</option>`;
                })
            );

            sel.innerHTML = matchOptions.join("");
            // Restore selection if still available
            if (
                currentSelection &&
                Array.from(sel.options).some(
                    (opt) => opt.value === currentSelection
                )
            ) {
                sel.value = currentSelection;
            } else {
                sel.selectedIndex = 0;
            }
            load.disabled = !sel.value;
        })();
    });
}

// Helper function to extract numeric part from match ID
function extractMatchNumber(matchId) {
    // Extract number from IDs like "S-Q10", "D-F2", "S-SF1"
    const match = matchId.match(/(\d+)$/);
    return match ? parseInt(match[1]) : 0;
}

/* hook change */
evt.addEventListener("change", () => refreshMatchDropdown(evt.value));
sel.addEventListener("change", () => (load.disabled = !sel.value));

/* ───── 3. session-resume ───── */
async function resumeIfAny() {
    const lastEvt = sessionStorage.getItem("currentEvent");
    const lastMatch = sessionStorage.getItem("currentMatch");
    if (!lastEvt) return;

    evt.value = lastEvt;
    await refreshMatchDropdown(lastEvt);

    if (lastMatch) {
        // Wait a bit for the dropdown to populate
        setTimeout(() => {
            if (
                Array.from(sel.options).some((opt) => opt.value === lastMatch)
            ) {
                sel.value = lastMatch;
                loadMatch(lastMatch, true);
            }
        }, 100);
    }
}

/* ───── load / display a match ───── */
load.addEventListener("click", () => sel.value && loadMatch(sel.value));

async function loadMatch(id, silent = false) {
    if (unsubLive) {
        unsubLive();
        unsubLive = null;
    }
    if (interval) {
        clearInterval(interval);
        interval = null;
    }

    const snap = await getDocs(
        query(collection(db, "matches"), where("__name__", "==", id))
    );
    const d = snap.docs[0];
    if (!d) {
        err("Match not found");
        return;
    }

    docRef = d.ref;

    /* remember in session */
    sessionStorage.setItem("currentEvent", evt.value);
    sessionStorage.setItem("currentMatch", id);

    const m = d.data();
    usedOvertime = false; // reset per match

    const teamAName = await resolveTeamName(m.event_id, m.competitor_a.id);
    const teamBName = await resolveTeamName(m.event_id, m.competitor_b.id);

    origRed = teamAName;
    origBlue = teamBName;

    flipped = false; // 🔥 RESET flip state for new match

    // 🔥 FIX: Reset all score button handlers for new match
    setupScoreButtons();

    renderNamesAndScores(m.score_a ?? 0, m.score_b ?? 0);

    label.textContent = `${id} · ${m.venue}`;
    // Set default timer only if match not started yet
    if (m.status === "scheduled") {
        const secs = defaultDurationSeconds(m);
        timer.textContent = `${pad((secs / 60) | 0)}:${pad(secs % 60)}`;
    }

    // Role-based editing restriction
    let canEdit = true;
    let user = window.firebase.auth.currentUser;
    let role = "scorekeeper";
    if (user) {
        const token = await user.getIdTokenResult();
        role = token.claims.role || "scorekeeper";
    }
    if (role === "scorekeeper") {
        // NEW: accept assignment via scorekeeper_email (plus legacy fields)
        const userEmail = user?.email ? user.email.toLowerCase() : null;
        const matchEmail = m.scorekeeper_email
            ? String(m.scorekeeper_email).toLowerCase()
            : null;
        const legacyEmail =
            typeof m.scorekeeper === "string" && m.scorekeeper.includes("@")
                ? m.scorekeeper.toLowerCase()
                : null;

        const emailMatch =
            (!!matchEmail && !!userEmail && matchEmail === userEmail) ||
            (!!legacyEmail && !!userEmail && legacyEmail === userEmail);

        const uidMatch =
            m.scorekeeper_uid === user.uid || m.scorekeeper === user.uid;

        const assigned = emailMatch || uidMatch;
        if (!assigned) canEdit = false;
    }

    // Enable/disable controls based on canEdit
    [start, end, ...document.querySelectorAll(".scoreBtn")].forEach((btn) => {
        if (canEdit) {
            btn.disabled = false;
            btn.classList.remove("opacity-60", "cursor-not-allowed");
        } else {
            btn.disabled = true;
            btn.classList.add("opacity-60", "cursor-not-allowed");
        }
    });
    if (!canEdit) {
        err("You are not assigned to this match and cannot edit it.");
    } else {
        msg.classList.add("hidden");
    }

    if (m.status === "live") startHidden();
    else showStart();
    pane.classList.remove("hidden");

    unsubLive = onSnapshot(docRef, (s) => {
        const d = s.data();
        if (d.status === "final") finishUI();
        renderNamesAndScores(d.score_a ?? 0, d.score_b ?? 0);
    });
}

/* ───── helpers for names / scores / logical conversion ───── */
function renderNamesAndScores(a, b) {
    redT.textContent = flipped ? origBlue : origRed;
    blueT.textContent = flipped ? origRed : origBlue;
    sA.textContent = flipped ? b : a;
    sB.textContent = flipped ? a : b;
}
function logicalScores() {
    return flipped
        ? { score_a: Number(sB.textContent), score_b: Number(sA.textContent) }
        : { score_a: Number(sA.textContent), score_b: Number(sB.textContent) };
}

/* ───── editable timer before start ───── */
timer.addEventListener("click", () => {
    if (start.hidden) return;
    const v = prompt("Set countdown (mm:ss)", timer.textContent);
    if (v && /^\d{1,2}:\d{2}$/.test(v)) timer.textContent = v;
});

/* ───── swap-sides button (locked until start) ───── */
const swapBtn = document.createElement("button");
swapBtn.textContent = "Swap Sides";
swapBtn.className =
    "mt-3 px-3 py-1 rounded bg-blue-600 text-white opacity-40 cursor-not-allowed";
swapBtn.disabled = true;
swapBtn.onclick = () => {
    if (swapBtn.disabled) return;
    flipped = !flipped;
    [sA.textContent, sB.textContent] = [sB.textContent, sA.textContent];
    const { score_a, score_b } = logicalScores();
    renderNamesAndScores(score_a, score_b);
};
timer.parentNode.insertBefore(swapBtn, timer.nextSibling);

/* ───── score buttons setup ───── */
let debounceTimer = null;
function pushLiveScores() {
    const { score_a, score_b } = logicalScores();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(
        () => updateDoc(docRef, { score_a, score_b }),
        200
    );
}

// 🔥 FIXED: Setup score buttons with proper event listeners
function setupScoreButtons() {
    // Remove any existing event listeners by cloning nodes
    document.querySelectorAll(".scoreBtn").forEach((btn) => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
    });

    // Add fresh event listeners
    document.querySelectorAll(".scoreBtn").forEach((btn) => {
        btn.addEventListener("click", () => {
            if (start.classList.contains("hidden") && !end.disabled) {
                // 🔥 SIMPLE: Left buttons update left display, right buttons update right display
                // Don't try to be smart about flipping - let the swap handle the logic

                let targetSpan;
                if (btn.dataset.side === "a") {
                    targetSpan = sA; // Always update scoreA display
                } else {
                    targetSpan = sB; // Always update scoreB display
                }

                targetSpan.textContent = Math.max(
                    0,
                    Number(targetSpan.textContent) + Number(btn.dataset.delta)
                );
                pushLiveScores();
            }
        });
    });
}

// 🔥 Initial setup of score buttons
setupScoreButtons();

/* ───── match control (start / end) ───── */
start.addEventListener("click", async () => {
    await updateDoc(docRef, {
        status: "live",
        actual_start: serverTimestamp(),
    });
    pushLiveScores();
    startHidden();
    startCountdown(toSeconds(timer.textContent));
});
end.addEventListener("click", async () => {
    if (end.disabled) return;
    if (
        !confirm(
            "Are you sure you want to end the match? This action cannot be undone."
        )
    )
        return;
    clearInterval(interval);
    await updateDoc(docRef, { status: "final", ...logicalScores() });
    finishUI();
});

/* ───── misc ui helpers ───── */
function toSeconds(txt) {
    const [m, s] = txt.split(":").map(Number);
    return m * 60 + s;
}
function startCountdown(sec) {
    clearInterval(interval);
    remainingSeconds = sec;
    awaitingOvertime = false;
    paused = false;
    if (pauseBtn) {
        pauseBtn.classList.remove("hidden");
        pauseBtn.textContent = "Pause";
        pauseBtn.disabled = false;
    }
    const tick = () => {
        if (paused) return; // don't decrement while paused
        timer.textContent = `${pad((remainingSeconds / 60) | 0)}:${pad(
            remainingSeconds % 60
        )}`;
        if (remainingSeconds-- <= 0) {
            clearInterval(interval);
            handleTimerExpired();
        }
    };
    tick();
    interval = setInterval(tick, 1000);
}
function handleTimerExpired() {
    if (awaitingOvertime || usedOvertime) return; // already prompting or OT used
    awaitingOvertime = true;
    setTimeout(() => {
        const v = prompt(
            "Time expired. Enter overtime minutes (blank = none):",
            ""
        );
        if (v == null || v.trim() === "") {
            awaitingOvertime = false;
            return;
        }
        const mins = parseInt(v.trim(), 10);
        if (!Number.isFinite(mins) || mins <= 0) {
            alert("Invalid number of minutes. No overtime added.");
            awaitingOvertime = false;
            return;
        }
        usedOvertime = true;
        // Visual indicator of overtime (pulse + color)
        timer.classList.add("text-red-600", "animate-pulse");
        startCountdown(mins * 60);
        // After restarting, stop pulsing after 5s
        setTimeout(() => timer.classList.remove("animate-pulse"), 5000);
    }, 50);
}

// Pause / Resume logic
if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
        if (pauseBtn.disabled) return;
        paused = !paused;
        if (paused) {
            pauseBtn.textContent = "Resume";
            pauseBtn.classList.remove("bg-yellow-500", "hover:bg-yellow-600");
            pauseBtn.classList.add("bg-green-600", "hover:bg-green-700");
        } else {
            pauseBtn.textContent = "Pause";
            pauseBtn.classList.remove("bg-green-600", "hover:bg-green-700");
            pauseBtn.classList.add("bg-yellow-500", "hover:bg-yellow-600");
        }
    });
}
function startHidden() {
    start.classList.add("hidden");
    end.classList.remove(
        "hidden",
        "bg-gray-800",
        "opacity-60",
        "cursor-default"
    );
    end.classList.add("bg-red-600", "hover:bg-red-700");
    end.disabled = false;
    swapBtn.disabled = false;
    swapBtn.classList.remove("opacity-40", "cursor-not-allowed");
}
function finishUI() {
    end.disabled = true;
    swapBtn.disabled = true;
    swapBtn.classList.add("opacity-40", "cursor-not-allowed");
    end.classList.remove("hover:bg-red-700", "bg-red-600");
    end.classList.add("bg-gray-800", "opacity-60", "cursor-default");
}
function showStart() {
    start.classList.remove("hidden", "opacity-60");
    end.classList.add("hidden");
    end.disabled = false;
}
function hidePanel() {
    pane.classList.add("hidden");
    if (unsubLive) {
        unsubLive();
        unsubLive = null;
    }
    if (interval) {
        clearInterval(interval);
        interval = null;
    }
}

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
    if (unsubLive) unsubLive();
    if (unsubMatchList) unsubMatchList();
});

// Utility to truncate long option text on very small screens
function truncateForMobile(text) {
    if (window.innerWidth >= 430) return text; // only truncate on very small devices
    // Keep status + id + basic time + teams
    // Original format: `${statusIcon} ${match.id} – ${fmt(match.scheduled_at)} – ${match.venue} (${teamA} vs ${teamB})`
    // We'll drop venue and shorten date to HH:MM
    return text
        .replace(/ – [^–]+ \(([^)]+)\)$/, " ($1)") // remove venue dash segment
        .replace(/(\d{2}:\d{2}).*?–/, "$1 –");
}