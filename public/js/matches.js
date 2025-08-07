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
    // Check for placeholder patterns like SFW1, SFW2, SBW1, SBW2, etc.
    return teamId.match(/^[SD][FB]W\d+$/);
}

function shouldShowMatch(match) {
    const { competitor_a, competitor_b, match_type, status } = match;

    // Always show qualifiers
    if (match_type === "qualifier") return true;

    // Don't show voided matches
    if (status === "void") return false;

    // For series matches (semi/bronze/final), only show if:
    // 1. Both competitors are real teams (not placeholders)
    // 2. OR the match has already started/finished
    const bothConfirmed =
        !isPlaceholder(competitor_a?.id) && !isPlaceholder(competitor_b?.id);
    const hasStarted = status === "live" || status === "final";

    return bothConfirmed || hasStarted;
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

/* ----------  live listener per event ---------- */
// Helper function to extract numeric part from match ID
function extractMatchNumber(matchId) {
    // Extract number from IDs like "S-Q10", "D-F2", "S-SF1"
    const match = matchId.match(/(\d+)$/);
    return match ? parseInt(match[1]) : 0;
}

function getMatchPriority(matchId) {
    // Order: Qualifiers → Semis → Bronze → Finals
    if (matchId.includes("-Q")) return 1;
    if (matchId.includes("-SF")) return 2;
    if (matchId.includes("-B")) return 3;
    if (matchId.includes("-F")) return 4;
    return 5;
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
            // Basic visibility check
            if (!shouldShowMatch(match)) return false;

            // Special handling for game 3
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
