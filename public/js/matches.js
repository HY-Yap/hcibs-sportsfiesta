/* Matches & Results — live table with sport tabs + date-time */
import {
    collection,
    query,
    where,
    onSnapshot,
    doc,
    getDoc,
    orderBy,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const db = window.firebase.db;
const container = document.getElementById("match-container");

/* ----------  team-name cache ---------- */
const cache = new Map();
async function teamName(id) {
    if (cache.has(id)) return cache.get(id);
    try {
        const s = await getDoc(doc(db, "teams", id));
        const n = s.exists() ? s.data().name : id;
        cache.set(id, n);
        return n;
    } catch {
        return id;
    }
}

/* ----------  tiny helpers ---------- */
const fmtDT = (d) =>
    d.toLocaleString("en-SG", {
        weekday: "short", // Fri / Sat
        day: "2-digit", // 22
        month: "short", // Aug
        hour: "2-digit",
        minute: "2-digit",
        hour12: false, // 20:00
    });

const td = (c, x = "") => `<td class="px-2 py-1 ${x}">${c}</td>`;
const scoreTd = (s, w) => td(s ?? "-", `text-right ${w ? "font-bold" : ""}`);
const teamTd = (n, w, col) =>
    td(
        n,
        `${w ? "font-bold " : ""}${
            col === "red" ? "text-red-600" : "text-blue-600"
        }`
    );

const badge = (st) => {
    const base = "inline-block px-2 py-0.5 rounded text-xs";
    const cls =
        {
            scheduled: `${base} bg-yellow-100 text-yellow-600`,
            live: `${base} bg-green-100  text-green-600 animate-pulse`,
            final: `${base} bg-gray-200   text-gray-700`,
        }[st] || `${base} bg-gray-100 text-gray-500`;
    return `<span class="${cls}">${
        st === "scheduled" ? "upcoming" : st
    }</span>`;
};

function renderTable(rows) {
    return `<div class="overflow-x-auto">
  <table class="min-w-full table-fixed whitespace-nowrap text-sm">
    <thead class="bg-primary text-white">
      <tr>
        <th class="px-2 py-1 w-20">Match</th>
        <th class="px-2 py-1 w-40">Date&nbsp;Time</th>
        <th class="px-2 py-1">Red Team</th>
        <th class="px-2 py-1 w-16 text-right">Score</th>
        <th class="px-2 py-1">Blue Team</th>
        <th class="px-2 py-1 w-16 text-right">Score</th>
        <th class="px-2 py-1 w-20 text-center">Venue</th>
        <th class="px-2 py-1 w-24 text-center">Status</th>
      </tr>
    </thead>
    <tbody>
      ${
          rows ||
          '<tr><td colspan="8" class="p-4 text-center text-gray-500">No matches yet.</td></tr>'
      }
    </tbody>
  </table>
</div>`;
}

/* ----------  live listener per sport ---------- */
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
            const aWin = m.status === "final" && m.score_a > m.score_b;
            const bWin = m.status === "final" && m.score_b > m.score_a;
            rows.push(`<tr class="even:bg-gray-50">
            ${td(`#${d.id}`, "w-20")}
            ${td(fmtDT(m.scheduled_at.toDate()), "w-40")}
            ${teamTd(red, aWin, "red")}
            ${scoreTd(m.score_a, aWin) /* already  w-16 in helper */}
            ${teamTd(blue, bWin, "blue")}
            ${scoreTd(m.score_b, bWin)}
            ${td(m.venue || "-", "w-20 text-center")}
            ${td(badge(m.status), "w-24 text-center")}
            </tr>`);
        }
        container.innerHTML = renderTable(rows.join(""));
    });
}

/* ----------  tab wiring ---------- */
(function initTabs() {
    const btns = document.querySelectorAll(".sport-tab");
    let unsub = null;
    const activate = (b) => {
        btns.forEach((x) =>
            x.classList.remove("border-primary", "text-primary")
        );
        b.classList.add("border-primary", "text-primary");
    };
    btns.forEach((b) => {
        b.addEventListener("click", () => {
            activate(b);
            if (unsub) unsub();
            unsub = listen(b.dataset.sport);
        });
    });
    (
        document.querySelector('[data-sport="badminton_singles"]') ||
        document.querySelector('[data-sport="badminton"]') ||
        btns[0]
    ).click();
})();
