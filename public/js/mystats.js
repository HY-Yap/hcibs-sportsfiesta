import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth } from "./firebase-init.js";

const statsMsg = document.getElementById("stats-msg");
const statsTables = document.getElementById("stats-tables");
const tabButtons = document.querySelectorAll('.sport-tab');

const EVENTS = [
  { id: 'badminton_singles', label: 'Badminton Singles' },
  { id: 'badminton_doubles', label: 'Badminton Doubles' },
  { id: 'frisbee5v5', label: 'Frisbee' },
  { id: 'basketball3v3', label: 'Basketball' },
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
    <div class="overflow-x-auto flex justify-center">
  <table class="min-w-full w-full table-auto whitespace-nowrap text-sm mx-auto">
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
  // Derive participation via teams (robust against missing events array)
  const teamsSnap = await getDocs(collection(db,'teams'));
  const userTeamSuffixesByEvent = {}; // eventId -> Set of suffix ids
  teamsSnap.forEach(teamDoc => {
    const t = teamDoc.data();
    if (t.member_emails && t.member_emails.includes(user.email)) {
      const suffix = teamDoc.id.includes('__') ? teamDoc.id.split('__').pop() : teamDoc.id;
      if(!userTeamSuffixesByEvent[t.event_id]) userTeamSuffixesByEvent[t.event_id] = new Set();
      userTeamSuffixesByEvent[t.event_id].add(suffix);
    }
  });

  const userEvents = new Set(Object.keys(userTeamSuffixesByEvent));

  function isPlaceholderId(id, eventId, matchType){
    if(!id) return true;
    if(/^(?:S|D)[FB]W\d+$/.test(id)) return true; // badminton finals/bronze placeholders
    if(/^(?:S|D)[1-4]$/.test(id)) return true; // badminton semi placeholders
    if(/^BW[1-8]$/.test(id)) return true; // basketball qualifiers placeholders
    if(/^B(?:QF[1-4]W|SF[12][WL])$/.test(id)) return true; // basketball progression tags
    if(/^F(?:R[12]W|SF[12][WL]|CHAMP)$/.test(id)) return true; // frisbee progression placeholders
    if(eventId === 'frisbee5v5' && matchType !== 'qualifier' && /^[ABC][1-4]$/.test(id)) return true; // frisbee group placeholders in elims
    return false;
  }

  function ordinal(n){
    if(typeof n !== 'number') return n;
    const v = n % 100;
    if(v>=11 && v<=13) return n + 'th';
    switch(n % 10){
      case 1: return n + 'st';
      case 2: return n + 'nd';
      case 3: return n + 'rd';
      default: return n + 'th';
    }
  }

  async function computeStats(eventId){
    // Query matches for this event
    const q = query(collection(db,'matches'), where('event_id','==', eventId));
    const snap = await getDocs(q);
    if(snap.empty) return { played:'NA', wins:'NA', draws:'NA', losses:'NA', placing:'NA' };

    // Aggregate per competitor
    const statsByCompetitor = new Map();
    const ensure = (id) => { if(!statsByCompetitor.has(id)) statsByCompetitor.set(id,{ id, played:0,wins:0,draws:0,losses:0}); return statsByCompetitor.get(id); };

    snap.docs.forEach(docSnap => {
      const m = docSnap.data();
      const aId = m.competitor_a?.id; const bId = m.competitor_b?.id;
      if(!aId || !bId) return;
      if(isPlaceholderId(aId, eventId, m.match_type) || isPlaceholderId(bId, eventId, m.match_type)) return; // skip placeholder until resolved
      if(m.status === 'void') return; // ignore voided
      if(m.status !== 'final') return; // only count completed matches
      const a = ensure(aId); const b = ensure(bId);
      a.played++; b.played++;
      const aScore = m.score_a ?? 0; const bScore = m.score_b ?? 0;
      if(aScore > bScore){ a.wins++; b.losses++; }
      else if(bScore > aScore){ b.wins++; a.losses++; }
      else { a.draws++; b.draws++; }
    });

    if(statsByCompetitor.size === 0) return { played:'NA', wins:'NA', draws:'NA', losses:'NA', placing:'NA' };

    // Sort competitors for ranking
    const list = Array.from(statsByCompetitor.values()).sort((x,y)=>{
      if(y.wins !== x.wins) return y.wins - x.wins;
      if(y.draws !== x.draws) return y.draws - x.draws;
      if(y.played !== x.played) return y.played - x.played;
      return x.id.localeCompare(y.id);
    });

    // Assign placements with ties (1,2,2,4 pattern)
    let prev=null; list.forEach((item,idx)=>{
      if(prev && prev.wins===item.wins && prev.draws===item.draws && prev.played===item.played){
        item.place = prev.place;
      } else {
        item.place = idx+1;
      }
      prev=item;
    });

    // Determine user's competitor id(s) for this event
    const userSuffixes = userTeamSuffixesByEvent[eventId] || new Set();
    const userIds = new Set([...userSuffixes, user.uid]);
    const userEntry = list.find(row => userIds.has(row.id));
    if(!userEntry) return { played:'NA', wins:'NA', draws:'NA', losses:'NA', placing:'NA' };
    return { played:userEntry.played, wins:userEntry.wins, draws:userEntry.draws, losses:userEntry.losses, placing: ordinal(userEntry.place) };
  }

  async function renderEvent(eventId){
    statsTables.innerHTML = '<p class="p-4 text-gray-500">Loading…</p>';
    const stats = await computeStats(eventId);
    statsTables.innerHTML = renderStatsTable(EVENTS.find(e=>e.id===eventId)?.label || eventId, stats);
  }

  tabButtons.forEach(btn => btn.addEventListener('click', ()=> {
    tabButtons.forEach(x=> x.classList.remove('border-primary','text-primary'));
    btn.classList.add('border-primary','text-primary');
    renderEvent(btn.dataset.sport);
  }));

  // auto-open first event user participates in else first tab
  for(const e of EVENTS){
    if(userEvents.has(e.id)){
      const b = document.querySelector(`.sport-tab[data-sport="${e.id}"]`);
      if(b){ b.click(); return; }
    }
  }
  const first = document.querySelector('.sport-tab');
  if(first) first.click();
});
