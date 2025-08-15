

import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { collection, getDocs, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db, auth } from "./firebase-init.js";

const matchesContainer = document.getElementById('matches-container');
const matchesMsg = document.getElementById('matches-msg');
const tabButtons = document.querySelectorAll('.sport-tab');

const EVENTS = [
  { id: 'badminton_singles', label: 'Badminton Singles' },
  { id: 'badminton_doubles', label: 'Badminton Doubles' },
  { id: 'frisbee5v5', label: 'Frisbee' },
  { id: 'basketball3v3', label: 'Basketball' },
];

function showMsg(text) { matchesMsg.textContent = text; matchesMsg.classList.remove('hidden'); }
function hideMsg() { matchesMsg.classList.add('hidden'); }

function badge(st) {
  const classes = ({
    scheduled : 'bg-yellow-200 text-yellow-900',
    live      : 'bg-green-200 text-green-900 animate-pulse',
    final     : 'bg-gray-300 text-gray-800',
    void      : 'bg-red-200 text-red-900',
  })[st] ?? 'bg-gray-100 text-gray-600';
  return `<span class="inline-block px-2 py-0.5 rounded text-xs ${classes}">${st === 'scheduled' ? 'upcoming' : st === 'void' ? 'cancelled' : st}</span>`;
}

function fmtDT(ts) {
  if (!ts || !ts.toDate) return '-';
  const d = ts.toDate();
  return d.toLocaleString('en-SG', { weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', hour12:false });
}

function tableShell(rowsHtml) {
  return `
    <div class="overflow-x-auto">
      <table class="min-w-full table-fixed whitespace-nowrap text-sm md:text-base">
        <thead class="bg-primary text-white">
          <tr>
            <th class="w-20 px-3 py-2">Match</th>
            <th class="w-48 px-3 py-2">Date&nbsp;Time</th>
            <th class="px-3 py-2">Player/Team&nbsp;1</th>
            <th class="w-20 px-3 py-2 text-center">Score</th>
            <th class="px-3 py-2">Player/Team&nbsp;2</th>
            <th class="w-20 px-3 py-2 text-center">Score</th>
            <th class="w-24 px-3 py-2 text-center">Venue</th>
            <th class="w-28 px-3 py-2 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          ${rowsHtml || `<tr><td colspan="8" class="p-6 text-center text-gray-500">No matches.</td></tr>`}
        </tbody>
      </table>
    </div>`;
}

// Placeholder detection mirroring logic used in matches.js to suppress unrevealed slots
function isPlaceholder(teamId, match){
  if(!teamId) return true;
  // Badminton finals/bronze placeholders
  if(/^(?:S|D)[FB]W\d+$/.test(teamId)) return true;
  // Badminton early placeholders (optional seeds)
  if(/^(?:S|D)[1-4]$/.test(teamId)) return true;
  // Basketball seed & progression placeholders
  if(/^BW[1-8]$/.test(teamId)) return true;
  if(/^B(?:QF[1-4]W|SF[12][WL])$/.test(teamId)) return true;
  // Frisbee progression placeholders
  if(/^F(?:R[12]W|SF[12][WL]|CHAMP)$/.test(teamId)) return true;
  // Frisbee group placeholders in elims (exclude qualifiers)
  if(match?.event_id === 'frisbee5v5' && match?.match_type !== 'qualifier' && /^[ABC][1-4]$/.test(teamId)) return true;
  return false;
}

async function loadUserMatches(user, allMatches, teamNameBySuffix, eventId) {
  // Filter only matches for this event
  const eventMatches = allMatches.filter(m => m.event_id === eventId);
  if (eventMatches.length === 0) return [];
  return eventMatches.filter(m => {
    // Determine if user participated (team suffix or individual)
    const isIndividual = (m.competitor_a?.id === user.uid || m.competitor_b?.id === user.uid || m.competitor_a?.email === user.email || m.competitor_b?.email === user.email);
    if (isIndividual) return true;
    // team membership: competitor ids are suffixes; reconstruct suffix map
    // We'll build a set of user team suffixes for this event
    return false; // We'll override below after computing suffixes
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { showMsg('Please log in to view your matches.'); return; }
  const userSnap = await getDoc(doc(db,'users',user.uid));
  if(!userSnap.exists()) { showMsg('User data not found.'); return; }
  const userData = userSnap.data();
  const tokenResult = await user.getIdTokenResult();
  const role = tokenResult.claims.role || userData.role || 'user';
  if (role === 'scorekeeper' || role === 'admin') { window.location.href='dashboard.html'; return; }
  hideMsg();

  // Build user team suffix sets per event
  const teamsSnap = await getDocs(collection(db,'teams'));
  const userTeamSuffixesByEvent = {}; // eventId -> Set(suffixes)
  teamsSnap.forEach(teamDoc => {
    const t = teamDoc.data();
    if (t.member_emails && t.member_emails.includes(user.email)) {
      const suffix = teamDoc.id.includes('__') ? teamDoc.id.split('__').pop() : teamDoc.id;
      if(!userTeamSuffixesByEvent[t.event_id]) userTeamSuffixesByEvent[t.event_id] = new Set();
      userTeamSuffixesByEvent[t.event_id].add(suffix);
    }
  });

  // Preload all matches & team names once
  const matchesSnap = await getDocs(collection(db,'matches'));
  const allMatches = matchesSnap.docs.map(d=> ({ id:d.id, ...d.data() }));
  const teamNameBySuffix = {};
  teamsSnap.forEach(teamDoc => {
    const t = teamDoc.data();
    const suffix = teamDoc.id.includes('__') ? teamDoc.id.split('__').pop() : teamDoc.id;
    teamNameBySuffix[suffix] = t.name || suffix;
  });

  function renderEvent(eventId){
    const eventMatches = allMatches
      .filter(m=> m.event_id === eventId)
      // Exclude cancelled/voided
      .filter(m => m.status !== 'void')
      // Exclude matches where either competitor is still a placeholder (so user only sees confirmed brackets)
      .filter(m => !isPlaceholder(m.competitor_a?.id, m) && !isPlaceholder(m.competitor_b?.id, m))
      .filter(m => {
      const suffixSet = userTeamSuffixesByEvent[eventId] || new Set();
      const aId = m.competitor_a?.id;
      const bId = m.competitor_b?.id;
      const teamInvolved = aId && suffixSet.has(aId) || bId && suffixSet.has(bId);
      const individual = (aId === user.uid || bId === user.uid || m.competitor_a?.email === user.email || m.competitor_b?.email === user.email);
      return teamInvolved || individual;
    });
    if(eventMatches.length === 0){
      matchesContainer.innerHTML = tableShell('');
      return;
    }
    eventMatches.sort((a,b)=> (a.scheduled_at && b.scheduled_at) ? a.scheduled_at.toMillis() - b.scheduled_at.toMillis() : 0);
    const rows = eventMatches.map(m => {
      const compA = teamNameBySuffix[m.competitor_a?.id] || m.competitor_a?.name || m.competitor_a?.id || '-';
      const compB = teamNameBySuffix[m.competitor_b?.id] || m.competitor_b?.name || m.competitor_b?.id || '-';
      const scoreA = typeof m.score_a === 'number' ? m.score_a : null;
      const scoreB = typeof m.score_b === 'number' ? m.score_b : null;
      const isFinal = m.status === 'final';
      const aWin = isFinal && scoreA > scoreB;
      const bWin = isFinal && scoreB > scoreA;
      const tie = isFinal && scoreA === scoreB;
      const cellColour = (winner, loser) => tie ? 'bg-yellow-200' : winner ? 'bg-green-200' : loser ? 'bg-red-200' : '';
      const aCls = cellColour(aWin,bWin); const bCls = cellColour(bWin,aWin);
      return `
        <tr class="even:bg-gray-50 text-center">
          <td class="font-mono px-3 py-2">${m.id}</td>
          <td class="px-3 py-2">${fmtDT(m.scheduled_at)}</td>
          <td class="font-semibold ${aCls} px-3 py-2">${compA}</td>
          <td class="font-semibold ${aCls} text-center px-3 py-2">${m.score_a ?? '-'}</td>
          <td class="font-semibold ${bCls} px-3 py-2">${compB}</td>
          <td class="font-semibold ${bCls} text-center px-3 py-2">${m.score_b ?? '-'}</td>
          <td class="text-center px-3 py-2">${m.venue || '-'}</td>
          <td class="text-center px-3 py-2">${badge(m.status)}</td>
        </tr>`;
    }).join('');
    matchesContainer.innerHTML = tableShell(rows);
  }

  // Tab wiring
  tabButtons.forEach(btn => btn.addEventListener('click', () => {
    tabButtons.forEach(x=> x.classList.remove('border-primary','text-primary'));
    btn.classList.add('border-primary','text-primary');
    renderEvent(btn.dataset.sport);
  }));

  // Auto open first available tab (with matches) else first tab
  for (const e of EVENTS){
    const any = allMatches.some(m => m.event_id === e.id && (
      (userTeamSuffixesByEvent[e.id] && (userTeamSuffixesByEvent[e.id].has(m.competitor_a?.id) || userTeamSuffixesByEvent[e.id].has(m.competitor_b?.id))) ||
      m.competitor_a?.id === user.uid || m.competitor_b?.id === user.uid || m.competitor_a?.email === user.email || m.competitor_b?.email === user.email
    ));
    if(any){
      const btn = document.querySelector(`.sport-tab[data-sport="${e.id}"]`);
      if(btn){ btn.click(); return; }
    }
  }
  // fallback
  const first = document.querySelector('.sport-tab');
  if(first) first.click();
});
