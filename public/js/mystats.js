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

function renderStatsTable(eventLabel, stats, eventId) {
  const hasGroup = ['basketball3v3','frisbee5v5','badminton_singles','badminton_doubles'].includes(eventId);
  const fmtDiff = (v) => {
    if(v === 'NA') return v;
    if(v === undefined || v === null) return 'NA';
    const n = Number(v);
    if(isNaN(n)) return v;
    return n>0 ? `+${n}` : `${n}`;
  };
  return `
    <div class="overflow-x-auto flex justify-center">
  <table class="min-w-full w-full table-auto whitespace-nowrap text-sm md:text-base mx-auto">
        <thead class="bg-primary text-white">
          <tr>
    <th class="px-4 py-3">Matches Played</th>
    <th class="px-4 py-3">Wins</th>
    <th class="px-4 py-3">Losses</th>
    <th class="px-4 py-3">Points For</th>
    <th class="px-4 py-3">Points Against</th>
    <th class="px-4 py-3">Points Diff</th>
    ${hasGroup ? '<th class="px-4 py-3">Group Ranking</th>' : ''}
          </tr>
        </thead>
        <tbody>
          <tr>
    <td class="text-center px-4 py-3">${stats.played}</td>
    <td class="text-center px-4 py-3">${stats.wins}</td>
    <td class="text-center px-4 py-3">${stats.losses}</td>
    <td class="text-center px-4 py-3">${stats.pointsFor ?? 'NA'}</td>
    <td class="text-center px-4 py-3">${stats.pointsAgainst ?? 'NA'}</td>
  <td class="text-center px-4 py-3">${fmtDiff(stats.pointsDiff ?? 'NA')}</td>
    ${hasGroup ? `<td class="text-center px-4 py-3">${stats.groupPlacing ?? 'NA'}</td>` : ''}
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
    // Only treat S1-S4/D1-D4 as placeholders for badminton, NOT basketball
    if(eventId !== 'basketball3v3' && /^(?:S|D)[1-4]$/.test(id)) return true; // badminton semi placeholders
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
    const q = query(collection(db,'matches'), where('event_id','==', eventId));
    const snap = await getDocs(q);
  if(snap.empty) return { played:'NA', wins:'NA', losses:'NA', pointsFor:'NA', pointsAgainst:'NA', pointsDiff:'NA', groupPlacing:'NA' };

    const overall = new Map();
    const qualifierMatches = [];
    const allMatches = [];
    const ensureOverall = (id) => { if(!overall.has(id)) overall.set(id,{ id, played:0,wins:0,losses:0,pointsFor:0,pointsAgainst:0,pointsDiff:0}); return overall.get(id); };

    snap.docs.forEach(docSnap => {
      const m = docSnap.data();
      allMatches.push(m);
      const aId = m.competitor_a?.id; const bId = m.competitor_b?.id;
      if(!aId || !bId) return; // skip incomplete
      if(isPlaceholderId(aId, eventId, m.match_type) || isPlaceholderId(bId, eventId, m.match_type)) return; // skip placeholders
      if(m.status === 'void') return;
      if(m.status !== 'final') return; // only finished matches count
      if(m.match_type === 'qualifier') qualifierMatches.push(m);
      const a = ensureOverall(aId); const b = ensureOverall(bId);
      a.played++; b.played++;
      const aScore = m.score_a ?? 0; const bScore = m.score_b ?? 0;
      a.pointsFor += aScore; a.pointsAgainst += bScore; a.pointsDiff = a.pointsFor - a.pointsAgainst;
      b.pointsFor += bScore; b.pointsAgainst += aScore; b.pointsDiff = b.pointsFor - b.pointsAgainst;
      if(aScore > bScore){ a.wins++; b.losses++; }
      else if(bScore > aScore){ b.wins++; a.losses++; }
      // ties ignored (no draws tracked or displayed)
    });

	if(overall.size === 0) return { played:'NA', wins:'NA', losses:'NA', pointsFor:'NA', pointsAgainst:'NA', pointsDiff:'NA', groupPlacing:'NA' };

    const list = Array.from(overall.values()).sort((x,y)=>{
      if(y.wins !== x.wins) return y.wins - x.wins;
      if(y.pointsDiff !== x.pointsDiff) return y.pointsDiff - x.pointsDiff; // Higher points difference = better
      if(y.played !== x.played) return y.played - x.played;
      return x.id.localeCompare(y.id);
    });
  // Unique overall places (no shared ranks)
  list.forEach((item,idx)=>{ item.place = idx+1; });

    const userSuffixes = userTeamSuffixesByEvent[eventId] || new Set();
    const userIds = new Set([...userSuffixes, user.uid]);
    const userEntry = list.find(row => userIds.has(row.id));
  if(!userEntry) return { played:'NA', wins:'NA', losses:'NA', pointsFor:'NA', pointsAgainst:'NA', pointsDiff:'NA', groupPlacing:'NA' };

    // Group / advancement ranking
    let groupPlacing = 'NA';
    if(['basketball3v3','frisbee5v5','badminton_singles','badminton_doubles'].includes(eventId) && qualifierMatches.length){
      // find user's pool
      const userPool = qualifierMatches.reduce((pool, m) => {
        if(pool) return pool;
        const aId = m.competitor_a?.id; const bId = m.competitor_b?.id;
        if(userIds.has(aId) || userIds.has(bId)) return m.pool || null;
        return null;
      }, null);
      if(userPool){
        // Normalize basketball pool IDs (1-4 -> A-D)
        let normalizedPool = userPool;
        if(eventId === 'basketball3v3'){
          const digitToLetter = { '1':'A','2':'B','3':'C','4':'D' };
          normalizedPool = String(userPool).toUpperCase();
          if(digitToLetter[normalizedPool]) normalizedPool = digitToLetter[normalizedPool];
          const m = normalizedPool.match(/([A-D])$/);
          if(m) normalizedPool = m[1];
        }
        
        const poolStats = new Map();
        const ensurePool = (id) => { if(!poolStats.has(id)) poolStats.set(id,{ id, played:0,wins:0,losses:0,pointsFor:0,pointsAgainst:0,pointsDiff:0}); return poolStats.get(id); };
        qualifierMatches.filter(m => {
          let matchPool = m.pool;
          if(eventId === 'basketball3v3'){
            const digitToLetter = { '1':'A','2':'B','3':'C','4':'D' };
            matchPool = String(m.pool).toUpperCase();
            if(digitToLetter[matchPool]) matchPool = digitToLetter[matchPool];
            const poolMatch = matchPool.match(/([A-D])$/);
            if(poolMatch) matchPool = poolMatch[1];
          }
          return matchPool === normalizedPool;
        }).forEach(m => {
          const aId = m.competitor_a?.id; const bId = m.competitor_b?.id;
          if(!aId || !bId) return;
          if(isPlaceholderId(aId, eventId, m.match_type) || isPlaceholderId(bId, eventId, m.match_type)) return;
          const a = ensurePool(aId); const b = ensurePool(bId);
          a.played++; b.played++;
          const aScore = m.score_a ?? 0; const bScore = m.score_b ?? 0;
          a.pointsFor += aScore; a.pointsAgainst += bScore; a.pointsDiff = a.pointsFor - a.pointsAgainst;
          b.pointsFor += bScore; b.pointsAgainst += aScore; b.pointsDiff = b.pointsFor - b.pointsAgainst;
          if(aScore > bScore){ a.wins++; b.losses++; }
          else if(bScore > aScore){ b.wins++; a.losses++; }
        });
        if(poolStats.size){
          const poolList = Array.from(poolStats.values()).sort((x,y)=>{
            if(y.wins !== x.wins) return y.wins - x.wins;
            if(y.pointsDiff !== x.pointsDiff) return y.pointsDiff - x.pointsDiff; // Higher points difference = better
            if(y.played !== x.played) return y.played - x.played;
            return x.id.localeCompare(y.id);
          });
          poolList.forEach((item,idx)=>{ item.place = idx+1; });
          const poolUser = poolList.find(r => userIds.has(r.id));
          if(poolUser){
            let advLimit = 0;
            if(eventId.startsWith('badminton')) advLimit = 2; // semis
            else if(eventId==='basketball3v3') advLimit = 2; // top 2 from each group advance
            else if(eventId==='frisbee5v5'){
              // infer from elimination placeholders
              const elim = allMatches.filter(m=> m.match_type !== 'qualifier');
              const used = {};
              elim.forEach(m=>{
                [m.competitor_a?.id, m.competitor_b?.id].forEach(id=>{
                  if(/^([ABC])(\d+)$/.test(id||'')){
                    const pool=id[0]; const num=parseInt(id.slice(1),10); used[pool]=Math.max(used[pool]||0,num);
                  }
                });
              });
              advLimit = used[normalizedPool] || 0;
            }
            groupPlacing = ordinal(poolUser.place);
          }
        }
      }
    }

  return { 
    played: userEntry.played, 
    wins: userEntry.wins, 
    losses: userEntry.losses, 
    pointsFor: userEntry.pointsFor, 
    pointsAgainst: userEntry.pointsAgainst, 
    pointsDiff: userEntry.pointsDiff, 
    groupPlacing 
  };
  }

  async function renderEvent(eventId){
    statsTables.innerHTML = '<p class="p-4 text-gray-500">Loading…</p>';
    const stats = await computeStats(eventId);
  statsTables.innerHTML = renderStatsTable(EVENTS.find(e=>e.id===eventId)?.label || eventId, stats, eventId);
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
