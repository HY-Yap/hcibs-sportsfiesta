/*  Matches & Results — per-cell winner / loser highlight + live updates
    ------------------------------------------------------------------- */

import {
    collection,
    query,
    where,
    orderBy,
    onSnapshot,
    doc,
    getDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const db = window.firebase.db;
const container = document.getElementById("match-container");

/* ----------  team-name cache ---------- */
const cache = new Map();
async function teamName(id) {
    if (cache.has(id)) return cache.get(id);
    try {
        const snap = await getDoc(doc(db, "teams", id));
        const n = snap.exists() ? snap.data().name : id;
        cache.set(id, n);
        return n;
    } catch {
        return id;
    }
}

/* ----------  tiny helpers ---------- */
const fmtDT = (d) =>
    d.toLocaleString("en-SG", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    });

const td = (c, cls = "") => `<td class="px-2 py-1 ${cls}">${c}</td>`;
const teamTd = (txt, bold, cls = "") =>
    td(txt, `${cls} ${bold ? "font-bold" : ""}`);
const scoreTd = (val, bold, cls = "") =>
    td(val ?? "–", `text-center ${cls} ${bold ? "font-bold" : ""}`);

/* prettier-ignore */
const badge = (st) => {
  const classes = ({
    scheduled : "bg-yellow-200 text-yellow-900",
    live      : "bg-green-200  text-green-900 animate-pulse",
    final     : "bg-gray-300   text-gray-800",
    void      : "bg-red-200 text-red-900",
  })[st] ?? "bg-gray-100 text-gray-600";

  return `<span class="inline-block px-2 py-0.5 rounded text-xs ${classes}">
            ${st === "scheduled" ? "upcoming" : st === "void" ? "cancelled" : st}
          </span>`;
};

/* ----------  table shell ---------- */
function shell(rowsHtml) {
    return `
    <div class="overflow-x-auto">
        <table class="min-w-full table-fixed whitespace-nowrap text-sm">
            <thead class="bg-primary text-white">
                <tr>
                <th class="w-20  px-2 py-1">Match</th>
                <th class="w-44  px-2 py-1">Date&nbsp;Time</th>
                <th          class="px-2 py-1">Player/Team&nbsp;1</th>
                <th class="w-16  px-2 py-1 text-center">Score</th>
                <th          class="px-2 py-1">Player/Team&nbsp;2</th>
                <th class="w-16  px-2 py-1 text-center">Score</th>
                <th class="w-20  px-2 py-1 text-center">Venue</th>
                <th class="w-24  px-2 py-1 text-center">Status</th>
                </tr>
            </thead>
            <tbody>
                ${
                    rowsHtml ||
                    `
                <tr>
                    <td colspan="8" class="p-4 text-center text-gray-500">
                    No matches.
                    </td>
                </tr>`
                }
            </tbody>
        </table>
    </div>`;
}

/* ----------  progressive reveal helpers ---------- */
function isPlaceholder(teamId) {
    if (!teamId) return true;

    // Badminton finals/bronze placeholders: SFW1, SBW2, DFW1, DBW2
    if (/^(?:S|D)[FB]W\d+$/.test(teamId)) return true;

    // Basketball QF seeding placeholders: BW1..BW8
    if (/^BW[1-8]$/.test(teamId)) return true;

    // Basketball progression placeholders: BQF1W, BQF2W, BQF3W, BQF4W, BSF1W, BSF2W, BSF1L, BSF2L
    if (/^B(?:QF[1-4]W|SF[12][WL])$/.test(teamId)) return true;

    // (Optional) also hide badminton semi placeholders S1..S4 / D1..D4
    if (/^(?:S|D)[1-4]$/.test(teamId)) return true;

    return false;
}

function depsSatisfied(match, all) {
    const statusOf = (id) => all.find((m) => m.id === id)?.status;

    // ── Basketball (single-game) ──
    if (match.event_id === "basketball3v3") {
        if (match.id === "B-SF1") {
            return ["B-QF1", "B-QF2"].every((x) => statusOf(x) === "final");
        }
        if (match.id === "B-SF2") {
            return ["B-QF3", "B-QF4"].every((x) => statusOf(x) === "final");
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

    return true;
}

function shouldShowMatch(match, allMatches) {
    const { competitor_a, competitor_b, match_type, status } = match;

    // Always show qualifiers
    if (match_type === "qualifier") return true;

    // Don't show voided matches
    if (status === "void") return false;

    // Progressive dependency gate (e.g., B-SF waits for QFs, finals wait for SFs)
    if (!depsSatisfied(match, allMatches)) return false;

    // Show if both teams are real, or the match already started/finished
    const bothConfirmed =
        !isPlaceholder(competitor_a?.id) && !isPlaceholder(competitor_b?.id);
    const hasStarted = status === "live" || status === "final";

    return bothConfirmed || hasStarted;
}

function shouldShowGame3(matchId, allMatches) {
    // Only applies to BADMINTON series (Basketball uses single elimination)
    // Series game 3 patterns: S-F3, D-B3, S-SF1-3, D-SF2-3
    const isSeriesGame3 =
        matchId.match(/^[SD]-(F|B)3$/) || // Finals/Bronze game 3: S-F3, D-B3
        matchId.match(/^[SD]-SF\d+-3$/); // Semi game 3: S-SF1-3, D-SF2-3

    if (!isSeriesGame3) return true; // Not a badminton series game 3, always show

    // Find the series root
    let seriesRoot;
    if (matchId.includes("-SF")) {
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

/* ----------  live listener per event ---------- */
// Helper function to extract numeric part from match ID
function extractMatchNumber(matchId) {
    // Extract number from IDs like "S-Q10", "D-F2", "S-SF1"
    const match = matchId.match(/(\d+)$/);
    return match ? parseInt(match[1]) : 0;
}

function getMatchPriority(matchId) {
    // Universal priority order for all events
    if (matchId.includes("-Q")) return 1; // Qualifiers
    if (matchId.includes("-QF")) return 2; // Quarterfinals (Basketball)
    if (matchId.includes("-SF")) return 3; // Semifinals
    if (matchId.includes("-B")) return 4; // Bronze
    if (matchId.includes("-F")) return 5; // Finals
    return 6;
}

function listen(eventId) {
    container.innerHTML = '<p class="p-4 text-gray-500">Loading…</p>';

    const q = query(
        collection(db, "matches"),
        where("event_id", "==", eventId),
        orderBy("scheduled_at")
    );

    return onSnapshot(q, async (snap) => {
        // Get all matches for filtering logic
        const allMatches = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // Filter matches to show
        const visibleMatches = allMatches.filter((match) => {
            if (!shouldShowMatch(match, allMatches)) return false;

            if (match.id.endsWith("-3") || match.id.endsWith("3")) {
                return shouldShowGame3(match.id, allMatches);
            }
            return true;
        });

        // Sort the visible matches
        const sortedMatches = visibleMatches.sort((a, b) => {
            // First by match type priority
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

        const rows = [];

        for (const match of sortedMatches) {
            const [red, blue] = await Promise.all([
                teamName(match.competitor_a.id),
                teamName(match.competitor_b.id),
            ]);

            const isFinal = match.status === "final";
            const aWin = isFinal && match.score_a > match.score_b;
            const bWin = isFinal && match.score_b > match.score_a;
            const tie = isFinal && match.score_a === match.score_b;

            /* cell-level background */
            const cellColour = (winner, loser) =>
                tie
                    ? "bg-yellow-200"
                    : winner
                    ? "bg-green-200"
                    : loser
                    ? "bg-red-200"
                    : "";

            const aCls = cellColour(aWin, bWin);
            const bCls = cellColour(bWin, aWin);

            rows.push(`
        <tr class="even:bg-gray-50 text-center">
            ${td(`#${match.id}`)}
            ${td(fmtDT(match.scheduled_at.toDate()))}
            ${teamTd(red, aWin, aCls)}
            ${scoreTd(match.score_a, aWin, aCls)}
            ${teamTd(blue, bWin, bCls)}
            ${scoreTd(match.score_b, bWin, bCls)}
            ${td(match.venue || "–", "text-center")}
            ${td(badge(match.status), "text-center")}
        </tr>`);
        }

        container.innerHTML = shell(rows.join(""));
    });
}

/* ----------  sport-tabs wiring ---------- */
(function initTabs() {
    const btns = document.querySelectorAll(".sport-tab");
    let off = null;

    const activate = (b) => {
        btns.forEach((x) =>
            x.classList.remove("border-primary", "text-primary")
        );
        b.classList.add("border-primary", "text-primary");
    };

    btns.forEach((b) =>
        b.addEventListener("click", () => {
            activate(b);
            if (off) off(); // detach previous listener
            off = listen(b.dataset.sport);
        })
    );

    /* open first tab */
    (
        document.querySelector('[data-sport="badminton_singles"]') ||
        document.querySelector('[data-sport="badminton_doubles"]') ||
        btns[0]
    ).click();
})();
