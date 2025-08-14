import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from "./firebase-init.js";

const statsMsg = document.getElementById("stats-msg");
const statsTables = document.getElementById("stats-tables");

const EVENTS = [
  { id: "badminton_doubles", label: "Badminton" },
  { id: "frisbee5v5", label: "Frisbee" },
  { id: "basketball3v3", label: "Basketball" },
];

function showMsg(text) {
  statsMsg.textContent = text;
  statsMsg.classList.remove("hidden");
}
function hideMsg() {
  statsMsg.classList.add("hidden");
}

function renderStatsTable(eventLabel, stats) {
  return `
    <div class="bg-white rounded-lg shadow p-4">
      <h2 class="text-xl font-semibold mb-4 text-primary">${eventLabel}</h2>
      <table class="min-w-full table-fixed whitespace-nowrap text-sm">
        <thead class="bg-primary text-white">
          <tr>
            <th class="px-4 py-2">Matches Played</th>
            <th class="px-4 py-2">Wins</th>
            <th class="px-4 py-2">Draws</th>
            <th class="px-4 py-2">Losses</th>
            <th class="px-4 py-2">Current Placing</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="text-center">${stats.played}</td>
            <td class="text-center">${stats.wins}</td>
            <td class="text-center">${stats.draws}</td>
            <td class="text-center">${stats.losses}</td>
            <td class="text-center">${stats.placing}</td>
          </tr>
        </tbody>
      </table>
    </div>
  `;
}

import { collection, query, where, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-init.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showMsg("Please log in to view your stats.");
    return;
  }
  // Get user data from Firestore
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) {
    showMsg("User data not found.");
    return;
  }
  const userData = userSnap.data();
  const tokenResult = await user.getIdTokenResult();
  const role = tokenResult.claims.role || userData.role || "user";
  if (role === "scorekeeper" || role === "admin") {
    alert("You do not need to view this page. Redirecting to dashboard.");
    window.location.href = "dashboard.html";
    return;
  }
  hideMsg();
  const userEvents = Array.isArray(userData.events) ? userData.events : [];
  const userTeams = typeof userData.teams === "object" && userData.teams !== null ? userData.teams : {};
  let tablesHtml = "";
  for (const event of EVENTS) {
    let stats = { played: "NA", wins: "NA", draws: "NA", losses: "NA", placing: "NA" };
    if (userEvents.includes(event.id)) {
      const teamId = userTeams[event.id];
      let played = 0, wins = 0, draws = 0, losses = 0;
      // Query matches for this event
      const q = query(collection(db, "matches"), where("event_id", "==", event.id));
      const snap = await getDocs(q);
      for (const docSnap of snap.docs) {
        const m = docSnap.data();
        // Check if user/team is a participant
        const isIndividual = m.competitor_a?.id === user.uid || m.competitor_b?.id === user.uid;
        const isTeam = teamId && (m.competitor_a?.id === teamId || m.competitor_b?.id === teamId);
        if (isIndividual || isTeam) {
          // Only count matches that are not void
          if (m.status !== "void") {
            played++;
            // Only count matches that are final
            if (m.status === "final") {
              const aScore = m.score_a ?? 0;
              const bScore = m.score_b ?? 0;
              let isWin = false, isDraw = false, isLoss = false;
              if ((isIndividual && m.competitor_a?.id === user.uid) || (isTeam && m.competitor_a?.id === teamId)) {
                if (aScore > bScore) isWin = true;
                else if (aScore === bScore) isDraw = true;
                else isLoss = true;
              } else {
                if (bScore > aScore) isWin = true;
                else if (aScore === bScore) isDraw = true;
                else isLoss = true;
              }
              if (isWin) wins++;
              if (isDraw) draws++;
              if (isLoss) losses++;
            }
          }
        }
      }
      stats = { played, wins, draws, losses, placing: "NA" };
      // Optionally, you can add logic to get placing from userData or another global if needed
    }
    tablesHtml += renderStatsTable(event.label, stats);
  }
  statsTables.innerHTML = tablesHtml;
});
