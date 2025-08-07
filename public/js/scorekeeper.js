/*  public/js/scorekeeper.js  (v 7)
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

/* ───── progressive reveal helpers ───── */
function isPlaceholder(teamId) {
    if (!teamId) return true;
    // Check for placeholder patterns like SFW1, SFW2, SBW1, SBW2, etc.
    return teamId.match(/^[SD][FB]W\d+$/);
}

function shouldShowMatch(match, allMatches) {
    const { competitor_a, competitor_b, match_type, status } = match;

    // Always show qualifiers that aren't finished
    if (match_type === "qualifier") {
        return status !== "final";
    }

    // Don't show voided matches
    if (status === "void") return false;

    // For series matches (semi/bronze/final):
    // 1. Show if live or scheduled with real competitors
    // 2. Hide if finished
    // 3. Hide if still has placeholders (not ready yet)

    if (status === "final") return false; // Hide finished matches

    const bothConfirmed =
        !isPlaceholder(competitor_a?.id) && !isPlaceholder(competitor_b?.id);

    // Show if both teams are confirmed OR if it's already live
    return bothConfirmed || status === "live";
}

function shouldShowGame3(matchId, allMatches) {
    // Only check game 3 matches
    if (!matchId.endsWith("-3") && !matchId.endsWith("3")) return true;

    // Find the series root
    let seriesRoot;
    if (
        matchId.includes("-SF") ||
        matchId.includes("-F-") ||
        matchId.includes("-B-")
    ) {
        // Format: S-SF1-3 → S-SF1
        seriesRoot = matchId.replace(/-\d+$/, "");
    } else {
        // Format: S-F3 → S-F, S-B3 → S-B
        seriesRoot = matchId.replace(/\d+$/, "");
    }

    // Count wins in games 1 and 2
    const seriesGames = allMatches.filter(
        (m) =>
            m.id.startsWith(seriesRoot) &&
            m.status === "final" &&
            !m.id.endsWith("3")
    );

    if (seriesGames.length < 2) return false; // Need both games 1,2 finished

    const winCounts = {};
    seriesGames.forEach((game) => {
        if (game.score_a > game.score_b) {
            winCounts[game.competitor_a.id] =
                (winCounts[game.competitor_a.id] || 0) + 1;
        } else if (game.score_b > game.score_a) {
            winCounts[game.competitor_b.id] =
                (winCounts[game.competitor_b.id] || 0) + 1;
        }
    });

    // Show game 3 only if series is tied 1-1
    const wins = Object.values(winCounts);
    return wins.length === 2 && wins.every((w) => w === 1);
}

function getMatchPriority(matchId) {
    // Order: Live → Qualifiers → Semis → Bronze → Finals
    if (matchId.includes("-Q")) return 1;
    if (matchId.includes("-SF")) return 2;
    if (matchId.includes("-B")) return 3;
    if (matchId.includes("-F")) return 4;
    return 5;
}

function getMatchStatus(match) {
    if (match.status === "live") return "🔴 LIVE";
    if (match.status === "scheduled") return "⏰ Upcoming";
    return match.status;
}

/* ───── auth gate ───── */
onAuthStateChanged(auth, async (user) => {
    if (!user) return err("Please log in.");
    if ((await user.getIdTokenResult()).claims.role !== "scorekeeper")
        return err("Not a score-keeper account.");
    await populateEventDropdown();
    resumeIfAny();
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
        const allMatches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // Filter matches to show
        const visibleMatches = allMatches.filter((match) => {
            // Basic visibility check
            if (!shouldShowMatch(match, allMatches)) return false;

            // Special handling for game 3
            if (match.id.endsWith("-3") || match.id.endsWith("3")) {
                return shouldShowGame3(match.id, allMatches);
            }

            return true;
        });

        // Sort matches: Live first, then by priority, then by time, then by number
        const sortedMatches = visibleMatches.sort((a, b) => {
            // Live matches first
            if (a.status === "live" && b.status !== "live") return -1;
            if (b.status === "live" && a.status !== "live") return 1;

            // Then by match type priority
            const aPriority = getMatchPriority(a.id);
            const bPriority = getMatchPriority(b.id);
            if (aPriority !== bPriority) return aPriority - bPriority;

            // Then by scheduled time
            const aTime = a.scheduled_at.toMillis();
            const bTime = b.scheduled_at.toMillis();
            if (aTime !== bTime) return aTime - bTime;

            // Finally by match number
            const aMatch = extractMatchNumber(a.id);
            const bMatch = extractMatchNumber(b.id);
            return aMatch - bMatch;
        });

        // Remember current selection
        const currentSelection = sel.value;

        // Clear and repopulate dropdown
        sel.innerHTML = "";

        if (sortedMatches.length === 0) {
            sel.insertAdjacentHTML(
                "beforeend",
                `<option value="">No matches available</option>`
            );
            load.disabled = true;
            return;
        }

        sortedMatches.forEach((match) => {
            const statusIcon = getMatchStatus(match);
            const teamA = match.competitor_a?.id || "TBD";
            const teamB = match.competitor_b?.id || "TBD";

            sel.insertAdjacentHTML(
                "beforeend",
                `<option value="${match.id}">
                    ${statusIcon} ${match.id} – ${fmt(match.scheduled_at)} – ${
                    match.venue
                } (${teamA} vs ${teamB})
                </option>`
            );
        });

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
    origRed = m.competitor_a.id;
    origBlue = m.competitor_b.id;
    flipped = false;
    renderNamesAndScores(m.score_a ?? 0, m.score_b ?? 0);

    label.textContent = `${id} · ${m.venue}`;
    timer.textContent = "10:00";

    if (m.status === "live") startHidden();
    else showStart();
    pane.classList.remove("hidden");

    unsubLive = onSnapshot(docRef, (s) => {
        const d = s.data();
        if (d.status === "final") finishUI();
        renderNamesAndScores(d.score_a ?? 0, d.score_b ?? 0);
    });

    if (!silent) msg.classList.add("hidden");
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
    document.querySelectorAll(".scoreBtn").forEach((btn) => {
        btn.dataset.side = btn.dataset.side === "a" ? "b" : "a";
    });
    const { score_a, score_b } = logicalScores();
    renderNamesAndScores(score_a, score_b);
};
timer.parentNode.insertBefore(swapBtn, timer.nextSibling);

/* ───── score buttons (debounced live write) ───── */
let debounceTimer = null;
function pushLiveScores() {
    const { score_a, score_b } = logicalScores();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(
        () => updateDoc(docRef, { score_a, score_b }),
        200
    );
}
document.querySelectorAll(".scoreBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
        if (start.classList.contains("hidden") && !end.disabled) {
            const logical = btn.dataset.side === "a" ? 0 : 1;
            const span = flipped ? [sB, sA][logical] : [sA, sB][logical];
            span.textContent = Math.max(
                0,
                Number(span.textContent) + Number(btn.dataset.delta)
            );
            pushLiveScores();
        }
    });
});

/* ───── match control (start / end) ───── */
start.addEventListener("click", async () => {
    await updateDoc(docRef, {
        status: "live",
        actual_start: serverTimestamp(),
    });
    pushLiveScores();
    startHidden();
    countdown(toSeconds(timer.textContent));
});
end.addEventListener("click", async () => {
    if (end.disabled) return;
    clearInterval(interval);
    await updateDoc(docRef, { status: "final", ...logicalScores() });
    finishUI();
});

/* ───── misc ui helpers ───── */
function toSeconds(txt) {
    const [m, s] = txt.split(":").map(Number);
    return m * 60 + s;
}
function countdown(sec) {
    clearInterval(interval);
    const tick = () => {
        timer.textContent = `${pad((sec / 60) | 0)}:${pad(sec % 60)}`;
        if (sec-- <= 0) {
            clearInterval(interval);
        }
    };
    tick();
    interval = setInterval(tick, 1000);
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
