

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
    <div class="w-full min-h-[70vh] max-w-screen-xl mx-auto flex justify-center items-start py-6 px-1 sm:px-2 md:px-4 bg-white">
      <div class="w-full max-w-full">
        <div class="overflow-x-auto">
          <table class="min-w-[100vw] sm:min-w-[700px] table-auto whitespace-nowrap text-base border border-gray-300 rounded-lg shadow">
            <thead class="bg-primary text-white">
              <tr>
                <th class="w-24 px-4 py-2 text-center">Match</th>
                <th class="w-56 px-4 py-2 text-center">Date&nbsp;Time</th>
                <th class="px-4 py-2 text-center">Player/Team&nbsp;1</th>
                <th class="w-20 px-4 py-2 text-center">Score</th>
                <th class="px-4 py-2 text-center">Player/Team&nbsp;2</th>
                <th class="w-20 px-4 py-2 text-center">Score</th>
                <th class="w-28 px-4 py-2 text-center">Venue</th>
                <th class="w-28 px-4 py-2 text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml || `<tr><td colspan=\"8\" class=\"p-4 text-center text-gray-500\">No matches found.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
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

  // Find all teams where the user is a member (by email)
  const teamsSnap = await getDocs(collection(db, "teams"));
  const userTeams = [];
  const userTeamEventIds = new Set();
  teamsSnap.forEach((teamDoc) => {
    const teamData = teamDoc.data();
    if (teamData.member_emails && teamData.member_emails.includes(user.email)) {
      userTeams.push({ id: teamDoc.id, event_id: teamData.event_id, name: teamData.name });
      userTeamEventIds.add(teamData.event_id);
    }
  });
  console.log("[mymatches] user.email:", user.email);
  console.log("[mymatches] userTeams:", userTeams);

  // Get all matches (for all events the user is in as a team member or individual)
  const matchesSnap = await getDocs(collection(db, "matches"));
  let allMatches = [];
  let debugMatches = [];
  matchesSnap.forEach((docSnap) => {
    const m = docSnap.data();
    m.id = docSnap.id;
    debugMatches.push(m);
    // Debug: print each match's competitors
    console.log(`[mymatches] Checking match ${m.id}:`, {
      competitor_a: m.competitor_a,
      competitor_b: m.competitor_b,
      event_id: m.event_id
    });
    // Check if user is a team member in this match
    let foundTeam = null;
    for (const team of userTeams) {
      // Extract suffix after '__' in team.id, e.g. 'badminton_singles__SB1' => 'SB1'
      let teamSuffix = team.id.includes("__") ? team.id.split("__").pop() : team.id;
      if (m.competitor_a?.id === teamSuffix || m.competitor_b?.id === teamSuffix) {
        foundTeam = {...team, matchSuffix: teamSuffix};
        break;
      }
    }
    if (foundTeam) {
      let teamSuffix = foundTeam.matchSuffix;
      if (m.competitor_a?.id === teamSuffix) m.competitor_a.name = foundTeam.name || `Team ${teamSuffix}`;
      if (m.competitor_b?.id === teamSuffix) m.competitor_b.name = foundTeam.name || `Team ${teamSuffix}`;
      allMatches.push(m);
      console.log(`[mymatches] Match ${m.id} matched team:`, foundTeam.id, teamSuffix);
      return;
    }
    // Also check if user is an individual competitor (by UID or email)
    const isIndividual = (m.competitor_a?.id === user.uid || m.competitor_b?.id === user.uid ||
      m.competitor_a?.email === user.email || m.competitor_b?.email === user.email);
    if (isIndividual) {
      allMatches.push(m);
      console.log(`[mymatches] Match ${m.id} matched individual:`, user.uid, user.email);
    }
  });
  console.log("[mymatches] all matches in collection:", debugMatches);
  console.log("[mymatches] matches found for user:", allMatches);

  if (allMatches.length === 0) {
    showMsg("No matches found for you.");
    return;
  }

  // Sort by scheduled_at
  allMatches.sort((a, b) => {
    if (!a.scheduled_at || !b.scheduled_at) return 0;
    return a.scheduled_at.toMillis() - b.scheduled_at.toMillis();
  });
  // Prepare a lookup for all teams (id suffix -> name)
  const allTeamsSnap = await getDocs(collection(db, "teams"));
  const teamNameBySuffix = {};
  allTeamsSnap.forEach((teamDoc) => {
    const teamData = teamDoc.data();
    let teamSuffix = teamDoc.id.includes("__") ? teamDoc.id.split("__").pop() : teamDoc.id;
    teamNameBySuffix[teamSuffix] = teamData.name || teamSuffix;
  });

  // Render table
  const rows = allMatches.map((m) => {
    // For each match, show the team name for both competitors if possible
    let compA = m.competitor_a?.name || teamNameBySuffix[m.competitor_a?.id] || m.competitor_a?.id || "-";
    let compB = m.competitor_b?.name || teamNameBySuffix[m.competitor_b?.id] || m.competitor_b?.id || "-";

    // Use matches.js logic for background color
    let scoreA = typeof m.score_a === 'number' ? m.score_a : null;
    let scoreB = typeof m.score_b === 'number' ? m.score_b : null;
    let isFinal = m.status === "final";
    let aWin = isFinal && scoreA > scoreB;
    let bWin = isFinal && scoreB > scoreA;
    let tie = isFinal && scoreA === scoreB;
    const cellColour = (winner, loser) =>
      tie
        ? "bg-yellow-200"
        : winner
        ? "bg-green-200"
        : loser
        ? "bg-red-200"
        : "";
    let aCls = cellColour(aWin, bWin);
    let bCls = cellColour(bWin, aWin);

    return `
      <tr class="even:bg-gray-50 text-center">
        <td class="font-mono text-center align-middle">${m.id}</td>
        <td class="text-center align-middle">${fmtDT(m.scheduled_at)}</td>
        <td class="text-center align-middle font-semibold ${aCls}">${compA}</td>
        <td class="text-center align-middle font-semibold ${aCls}">${m.score_a ?? "-"}</td>
        <td class="text-center align-middle font-semibold ${bCls}">${compB}</td>
        <td class="text-center align-middle font-semibold ${bCls}">${m.score_b ?? "-"}</td>
        <td class="text-center align-middle">${m.venue || "-"}</td>
        <td class="text-center align-middle">${badge(m.status)}</td>
      </tr>
    `;
  }).join("");
  matchesContainer.innerHTML = renderTable(rows);
});
