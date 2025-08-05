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
  })[st] ?? "bg-gray-100 text-gray-600";

  return `<span class="inline-block px-2 py-0.5 rounded text-xs ${classes}">
            ${st === "scheduled" ? "upcoming" : st}
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

/* ----------  live listener per event ---------- */
function listen(eventId) {
    container.innerHTML = '<p class="p-4 text-gray-500">Loading…</p>';

    const q = query(
        collection(db, "matches"),
        where("event_id", "==", eventId),
        orderBy("scheduled_at")
    );

    return onSnapshot(q, async (snap) => {
        const rows = [];

        for (const d of snap.docs) {
            const m = d.data();
            const [red, blue] = await Promise.all([
                teamName(m.competitor_a.id),
                teamName(m.competitor_b.id),
            ]);

            const isFinal = m.status === "final";
            const aWin = isFinal && m.score_a > m.score_b;
            const bWin = isFinal && m.score_b > m.score_a;
            const tie = isFinal && m.score_a === m.score_b;

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
          ${td(`#${d.id}`)}
          ${td(fmtDT(m.scheduled_at.toDate()))}
          ${teamTd(red, aWin, aCls)}
          ${scoreTd(m.score_a, aWin, aCls)}
          ${teamTd(blue, bWin, bCls)}
          ${scoreTd(m.score_b, bWin, bCls)}
          ${td(m.venue || "–", "text-center")}
          ${td(badge(m.status), "text-center")}
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
