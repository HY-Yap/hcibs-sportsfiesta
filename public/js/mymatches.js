import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, query, where, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, auth } from "./firebase-init.js";

const matchesContainer = document.getElementById("matches-container");
const matchesMsg = document.getElementById("matches-msg");

function showMsg(text) {
  matchesMsg.textContent = text;
  matchesMsg.classList.remove("hidden");
}
function hideMsg() {
  matchesMsg.classList.add("hidden");
}

function renderTable(rowsHtml) {
  return `
    <div class="overflow-x-auto">
      <table class="min-w-full table-fixed whitespace-nowrap text-sm">
        <thead class="bg-primary text-white">
          <tr>
            <th class="w-20 px-2 py-1">Match</th>
            <th class="w-44 px-2 py-1">Date&nbsp;Time</th>
            <th class="px-2 py-1">Player/Team&nbsp;1</th>
            <th class="w-16 px-2 py-1 text-center">Score</th>
            <th class="px-2 py-1">Player/Team&nbsp;2</th>
            <th class="w-16 px-2 py-1 text-center">Score</th>
            <th class="w-20 px-2 py-1 text-center">Venue</th>
            <th class="w-24 px-2 py-1 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || `<tr><td colspan="8" class="p-4 text-center text-gray-500">No matches found.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function badge(st) {
  const classes = {
    scheduled: "bg-yellow-200 text-yellow-900",
    live: "bg-green-200 text-green-900 animate-pulse",
    final: "bg-gray-300 text-gray-800",
    void: "bg-red-200 text-red-900",
  }[st] ?? "bg-gray-100 text-gray-600";
  return `<span class="inline-block px-2 py-0.5 rounded text-xs ${classes}">${st === "scheduled" ? "upcoming" : st === "void" ? "cancelled" : st}</span>`;
}

function fmtDT(ts) {
  if (!ts || !ts.toDate) return "-";
  const d = ts.toDate();
  return d.toLocaleString("en-SG", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showMsg("Please log in to view your matches.");
    return;
  }
  // Get user data
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    showMsg("User data not found.");
    return;
  }
  const userData = userSnap.data();
  const role = userData.role || "user";
  if (role === "scorekeeper" || role === "admin") {
    alert("You do not need to view this page. Redirecting to dashboard.");
    window.location.href = "dashboard.html";
    return;
  }
  hideMsg();
  const userEvents = Array.isArray(userData.events) ? userData.events : [];
  const userTeams = typeof userData.teams === "object" && userData.teams !== null ? userData.teams : {};
  if (userEvents.length === 0) {
    showMsg("You are not registered for any events.");
    return;
  }
  // Query matches where user is a participant
  let allMatches = [];
  for (const eventId of userEvents) {
    // Individual: user.uid
    // Team: userTeams[eventId] (if exists)
    const teamId = userTeams[eventId];
    const q = query(
      collection(db, "matches"),
      where("event_id", "==", eventId)
    );
    const snap = await getDocs(q);
    snap.forEach((docSnap) => {
      const m = docSnap.data();
      m.id = docSnap.id;
      // Check if user is a participant
      const isIndividual = m.competitor_a?.id === user.uid || m.competitor_b?.id === user.uid;
      const isTeam = teamId && (m.competitor_a?.id === teamId || m.competitor_b?.id === teamId);
      if (isIndividual || isTeam) {
        allMatches.push(m);
      }
    });
  }
  // Sort by scheduled_at
  allMatches.sort((a, b) => {
    if (!a.scheduled_at || !b.scheduled_at) return 0;
    return a.scheduled_at.toMillis() - b.scheduled_at.toMillis();
  });
  // Render table
  const rows = allMatches.map((m) => {
    return `
      <tr>
        <td class="font-mono">${m.id}</td>
        <td>${fmtDT(m.scheduled_at)}</td>
        <td>${m.competitor_a?.id || "-"}</td>
        <td class="text-center">${m.score_a ?? "-"}</td>
        <td>${m.competitor_b?.id || "-"}</td>
        <td class="text-center">${m.score_b ?? "-"}</td>
        <td class="text-center">${m.venue || "-"}</td>
        <td class="text-center">${badge(m.status)}</td>
      </tr>
    `;
  }).join("");
  matchesContainer.innerHTML = renderTable(rows);
});
