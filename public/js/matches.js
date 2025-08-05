/*  Matches & Results — live table with sport tabs
    ---------------------------------------------- */

import {
    collection,
    query,
    where,
    onSnapshot,
    doc,
    getDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const db = window.firebase.db;
const container = document.getElementById("match-container");

/* ---------- team-name cache ---------- */
const nameCache = new Map();
async function teamName(id) {
    if (nameCache.has(id)) return nameCache.get(id);
    try {
        const snap = await getDoc(doc(db, "teams", id));
        const n = snap.exists() ? snap.data().name : id;
        nameCache.set(id, n);
        return n;
    } catch {
        return id;
    }
}

/* ---------- tiny render helpers ---------- */
const td = (c, x = "") => `<td class="px-2 py-1 ${x}">${c}</td>`;
const scoreTd = (s, w) => td(s ?? "-", `text-right ${w ? "font-bold" : ""}`);
const teamTd = (n, w, col) =>
    td(
        n,
        `${w ? "font-bold " : ""}${
            col === "red" ? "text-red-600" : "text-blue-600"
        }`
    );
function badge(st) {
    const base = "inline-block px-2 py-0.5 rounded text-xs";
    return (
        ({
            scheduled: `${base} bg-yellow-100 text-yellow-600">upcoming`,
            live: `${base} bg-green-100 text-green-600 animate-pulse">live`,
            final: `${base} bg-gray-200  text-gray-700">final`,
        }[st] || `${base} bg-gray-100 text-gray-500">${st}`) + "</span>"
    );
}

/* ---------- live listener ---------- */
function renderTable(bodyHtml) {
    return `<div class="overflow-x-auto">
    <table class="min-w-full whitespace-nowrap text-sm">
      <thead class="bg-primary text-white">
        <tr>${[
            "Match",
            "Red Team",
            "Score",
            "Blue Team",
            "Score",
            "Venue",
            "Status",
        ]
            .map((h) => `<th class="px-2 py-1">${h}</th>`)
            .join("")}
        </tr>
      </thead>
      <tbody>${
          bodyHtml ||
          '<tr><td colspan="7" class="p-4 text-center text-gray-500">No matches yet.</td></tr>'
      }
      </tbody>
    </table>
  </div>`;
}

function listenSport(eventId) {
    container.innerHTML = '<p class="p-4 text-gray-500">Loading…</p>';
    const q = query(
        collection(db, "matches"),
        where("event_id", "==", eventId)
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
        ${td(`#${d.id}`)}
        ${teamTd(red, aWin, "red")}
        ${scoreTd(m.score_a, aWin)}
        ${teamTd(blue, bWin, "blue")}
        ${scoreTd(m.score_b, bWin)}
        ${td(m.venue || "-", "text-center")}
        ${td(badge(m.status), "text-center")}
      </tr>`);
        }
        container.innerHTML = renderTable(rows.join(""));
    });
}

/* ---------- init: tab wiring, same highlight classes as schedule ---------- */
function initSportTabs() {
    const btns = document.querySelectorAll(".sport-tab");
    let unsub = null;

    const activate = (btn) => {
        btns.forEach((b) =>
            b.classList.remove("border-primary", "text-primary")
        );
        btn.classList.add("border-primary", "text-primary");
    };

    btns.forEach((btn) => {
        btn.addEventListener("click", () => {
            activate(btn);
            if (unsub) unsub();
            unsub = listenSport(btn.dataset.sport);
        });
    });

    // default = badminton
    (document.querySelector('[data-sport="badminton"]') || btns[0]).click();
}

initSportTabs(); // runs on module load
