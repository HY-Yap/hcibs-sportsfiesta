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
    getDocs,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const db = window.firebase.db;
const container = document.getElementById("match-container");
const rankingContainer = document.getElementById("ranking-container");

/* ----------  team-name cache with event-scoped resolution ---------- */
const cache = new Map();

// Helper function for event-scoped team name resolution
async function resolveTeamName(eventId, competitorId) {
    if (!competitorId) return competitorId;

    const cacheKey = `${eventId}__${competitorId}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    try {
        // Try namespaced first (new format)
        const namespacedId = `${eventId}__${competitorId}`;
        let snap = await getDoc(doc(db, "teams", namespacedId));

        // Fall back to legacy format
        if (!snap.exists()) {
            snap = await getDoc(doc(db, "teams", competitorId));
        }

        const name = snap.exists() ? snap.data().name : competitorId;
        cache.set(cacheKey, name);
        return name;
    } catch (error) {
        console.warn(`Failed to resolve team name for ${competitorId}:`, error);
        cache.set(cacheKey, competitorId);
        return competitorId;
    }
}

// Legacy function for backward compatibility
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

/* ---------- ranking helpers (mirrors mystats) ---------- */
function ordinal(n){
    if(typeof n !== 'number') return n;
    const v = n % 100; if(v>=11 && v<=13) return n + 'th';
    switch(n % 10){case 1: return n+'st'; case 2: return n+'nd'; case 3: return n+'rd'; default: return n+'th';}
}

function rankingTable(eventId, data){
    const hasGroup = ['basketball3v3','frisbee5v5','badminton_singles','badminton_doubles'].includes(eventId);
    // Remove draws + overall ranking per request
    const cols = ["Team","Matches Played","Wins","Losses","Points For","Points Against","Points Diff"]; if(hasGroup) cols.push("Group Rank");
    const header = cols.map(c=>`<th class="px-3 py-2 text-center">${c}</th>`).join('');

    // Determine unique pools present and assign colors
    const pools = Array.from(new Set(data.filter(d=>d.pool).map(d=>d.pool))).sort();
    const colorPalette = [
        'bg-blue-50','bg-green-50','bg-purple-50','bg-amber-50','bg-pink-50','bg-teal-50','bg-orange-50','bg-lime-50'
    ];
    const poolColor = p => {
        const idx = pools.indexOf(p);
        return idx === -1 ? '' : colorPalette[idx % colorPalette.length];
    };

    // Sort by pool (if any) then by groupPlace (if available) else overall place
    const sorted = data.slice().sort((a,b)=>{
        if(hasGroup){
            if(a.pool && b.pool && a.pool !== b.pool) return a.pool.localeCompare(b.pool);
            if(a.pool && !b.pool) return -1; if(!a.pool && b.pool) return 1;
            if(a.groupPlace && b.groupPlace && a.groupPlace !== b.groupPlace) return a.groupPlace - b.groupPlace;
        }
        return a.place - b.place;
    });

    const rows = sorted.map(r=>`<tr class="${r.pool?poolColor(r.pool):'even:bg-gray-50'}">
        <td class="px-3 py-2 font-medium text-center">${r.name || r.id}${r.pool?` <span class="text-xs text-gray-500 align-middle">(${r.pool})</span>`:''}</td>
        <td class="px-3 py-2 text-center">${r.played}</td>
        <td class="px-3 py-2 text-center">${r.wins}</td>
        <td class="px-3 py-2 text-center">${r.losses}</td>
        <td class="px-3 py-2 text-center">${r.pointsFor || 0}</td>
        <td class="px-3 py-2 text-center">${r.pointsAgainst || 0}</td>
        <td class="px-3 py-2 text-center">${r.pointsDiff || 0}</td>
        ${hasGroup ? `<td class="px-3 py-2 text-center">${r.groupPlace ? ordinal(r.groupPlace) : '—'}</td>` : ''}
    </tr>`).join('') || `<tr><td colspan="${cols.length}" class="p-4 text-center text-gray-500">No data yet.</td></tr>`;
    const legend = pools.length ? `<div class="flex flex-wrap gap-2 text-xs mt-2">${pools.map((p,i)=>`<span class="px-2 py-1 rounded ${colorPalette[i % colorPalette.length]}">Group ${p}</span>`).join('')}</div>` : '';
    return `<div class="overflow-x-auto"><table class="min-w-full table-auto text-sm md:text-base whitespace-nowrap">
     <thead class="bg-primary text-white"><tr>${header}</tr></thead>
     <tbody>${rows}</tbody></table>${legend}</div>`;
}

// Compute rankings including zero‑match teams & all pools.
// Optionally pass matches array (from listener) to avoid duplicate fetch.
async function computeRankings(eventId, existingMatches){
    const stats = new Map();
    const ensure = id => { if(!stats.has(id)) stats.set(id,{ id, played:0, wins:0, losses:0, pointsFor:0, pointsAgainst:0, pointsDiff:0 }); return stats.get(id); };

    // Use passed matches or fetch
    let matches = existingMatches;
    if(!matches){
        const matchSnap = await getDocs(query(collection(db,'matches'), where('event_id','==', eventId)));
        matches = matchSnap.docs.map(d=> ({id:d.id, ...d.data()}));
    }

    // Derive pools & initial team entries from ALL qualifier matches (including scheduled ones).
    // This ensures we see all groups even before matches are played.
    matches.filter(m=> m.match_type==='qualifier' && m.pool).forEach(m => {
        const aId = m.competitor_a?.id, bId = m.competitor_b?.id;
        if(!aId||!bId) return;
        // Include ALL teams from qualifiers, even if they're currently placeholders
        const a = ensure(aId), b = ensure(bId);
        if(!a.pool) a.pool = m.pool; if(!b.pool) b.pool = m.pool;
    });

    // Normalize basketball pool ids (allow 1-4, A-D, 'Group A', etc.)
    if(eventId === 'basketball3v3'){
        const digitToLetter = { '1':'A','2':'B','3':'C','4':'D' };
        stats.forEach(rec => { if(rec.pool){ let p = String(rec.pool).toUpperCase(); if(digitToLetter[p]) p=digitToLetter[p]; const m=p.match(/([A-D])$/); if(m) rec.pool=m[1]; } });
    }

    // Helper: a team is countable only if not a placeholder
    const isCountable = (id, match) => !!id && !isPlaceholder(id, match);

    // Tally only final, non-void matches for win/loss stats
    // Count matches if the current team IDs are real (not placeholders)
    matches.filter(m=> m.status==='final' && m.status!=='void').forEach(m => {
        const aId = m.competitor_a?.id, bId = m.competitor_b?.id;
        if(!aId||!bId) return; 
        
        // Count stats for real team IDs even if match originally had placeholders
        const aIsReal = !isPlaceholder(aId, {event_id: eventId});
        const bIsReal = !isPlaceholder(bId, {event_id: eventId});
        
        if(aIsReal || bIsReal) { // At least one real team
            const as = m.score_a??0, bs = m.score_b??0;
            
            if(aIsReal) {
                const a = ensure(aId);
                a.played++;
                a.pointsFor += as;
                a.pointsAgainst += bs;
                a.pointsDiff = a.pointsFor - a.pointsAgainst;
                if(as>bs) a.wins++; else if(bs>as) a.losses++;
            }
            if(bIsReal) {
                const b = ensure(bId);
                b.played++;
                b.pointsFor += bs;
                b.pointsAgainst += as;
                b.pointsDiff = b.pointsFor - b.pointsAgainst;
                if(bs>as) b.wins++; else if(as>bs) b.losses++;
            }
        }
    });
    
    // Filter out placeholder teams from final rankings display
    let list = Array.from(stats.values())
        .filter(rec => !isPlaceholder(rec.id, {event_id: eventId})) // Remove placeholders from display
        .sort((x,y)=>{
        if(y.wins!==x.wins) return y.wins-x.wins; // More wins = better
        if(y.pointsDiff!==x.pointsDiff) return y.pointsDiff-x.pointsDiff; // Higher points difference = better
        if(y.played!==x.played) return y.played-x.played;
        return x.id.localeCompare(y.id);
    });
    list.forEach((it,i)=>{ it.place = i+1; });

    // Pool-specific ordering: compute groupPlace only if any finals in that pool; otherwise leave blank
    const pools = [...new Set(list.map(r=> r.pool).filter(Boolean))];
    pools.forEach(pool => {
    const poolFinals = matches.filter(m=> m.match_type==='qualifier' && m.pool===pool && m.status==='final');
        if(poolFinals.length===0) return; // no results yet
        // Build mini table for that pool with points tracking
        const poolStats = new Map();
        const ensureP = id => { if(!poolStats.has(id)) poolStats.set(id,{id,played:0,wins:0,losses:0,pointsFor:0,pointsAgainst:0,pointsDiff:0}); return poolStats.get(id); };
    poolFinals.forEach(m=> { 
        const aId=m.competitor_a?.id, bId=m.competitor_b?.id; 
        if(!aId||!bId) return; 
        const aIsReal = !isPlaceholder(aId, {event_id: eventId});
        const bIsReal = !isPlaceholder(bId, {event_id: eventId});
        if(!(aIsReal && bIsReal)) return; // Only count if both are real for pool stats
        
        const a=ensureP(aId), b=ensureP(bId); 
        const as=m.score_a??0, bs=m.score_b??0;
        a.played++; b.played++;
        a.pointsFor += as; a.pointsAgainst += bs; a.pointsDiff = a.pointsFor - a.pointsAgainst;
        b.pointsFor += bs; b.pointsAgainst += as; b.pointsDiff = b.pointsFor - b.pointsAgainst;
        if(as>bs){a.wins++; b.losses++;} else if(bs>as){b.wins++; a.losses++;} 
    });
        const ordered = Array.from(poolStats.values()).sort((x,y)=>{ 
            if(y.wins!==x.wins) return y.wins-x.wins; 
            if(y.pointsDiff!==x.pointsDiff) return y.pointsDiff-x.pointsDiff; 
            if(y.played!==x.played) return y.played-x.played; 
            return x.id.localeCompare(y.id); 
        });
        ordered.forEach((rec,i)=> { const overall = list.find(r=> r.id===rec.id); if(overall) overall.groupPlace = i+1; });
    });

    // Removed basketball override so its groups mirror other sports: groupPlace appears only after results.

    // Resolve names
    await Promise.all(list.map(async rec => { rec.name = await resolveTeamName(eventId, rec.id); }));
    return list;
}

/* ----------  progressive reveal helpers ---------- */
function isPlaceholder(teamId, match) {
    if (!teamId) return true;

    // Badminton finals/bronze placeholders
    if (/^(?:S|D)[FB]W\d+$/.test(teamId)) return true;

    // Basketball placeholders (seed & progression tags)
    if (/^BW[1-8]$/.test(teamId)) return true;
    if (/^B(?:QF[1-4]W|SF[12][WL])$/.test(teamId)) return true;

    // (Optional) badminton semi placeholders (S1..S4 / D1..D4)
    // Only treat as placeholders for badminton, NOT basketball
    if (match?.event_id !== "basketball3v3" && /^(?:S|D)[1-4]$/.test(teamId)) return true;

    // Frisbee placeholders used in elims
    if (/^F(?:R[12]W|SF[12][WL]|CHAMP)$/.test(teamId)) return true;

    // 🔴 IMPORTANT: Only treat A1..C4 as placeholders for frisbee elims,
    // not for basketball.
    if (
        match?.event_id === "frisbee5v5" &&
        match?.match_type !== "qualifier" &&
        /^[ABC][1-4]$/.test(teamId)
    ) {
        return true;
    }

    return false;
}

function depsSatisfied(match, all) {
    const statusOf = (id) => all.find((m) => m.id === id)?.status;

    // ── Basketball ──
    if (match.event_id === "basketball3v3") {
        // QF matches need all qualifiers to be final
        if (/^B-QF[1-4]$/.test(match.id)) {
            return all
                .filter(
                    (m) =>
                        m.event_id === "basketball3v3" &&
                        m.match_type === "qualifier"
                )
                .every((m) => m.status === "final");
        }

        if (match.id === "B-SF1")
            return ["B-QF1", "B-QF2"].every((x) => statusOf(x) === "final");
        if (match.id === "B-SF2")
            return ["B-QF3", "B-QF4"].every((x) => statusOf(x) === "final");
        if (/^B-(F1|B1)$/.test(match.id))
            return ["B-SF1", "B-SF2"].every((x) => statusOf(x) === "final");
    }

    // ── Badminton BO3 ──
    if (/^[SD]-(F|B)[23]$/.test(match.id)) {
        const opener = match.id.replace(/[23]$/, "1");
        const st = statusOf(opener);
        return st === "live" || st === "final";
    }

    // ── Frisbee ── (Fixed dependency logic)
    if (match.event_id === "frisbee5v5") {
        const qualsDone = all
            .filter(
                (m) =>
                    m.event_id === "frisbee5v5" && m.match_type === "qualifier"
            )
            .every((m) => m.status === "final");

        // Redemption (only after all qualifiers done)
        if (/^F-R[12]$/.test(match.id)) return qualsDone;

        // QF1/QF2: show only after BOTH redemption matches are FINAL
        if (/^F-QF[12]$/.test(match.id)) {
            return statusOf("F-R1") === "final" && statusOf("F-R2") === "final";
        }

        // 🔥 QF3/QF4: only check if redemption is done, NOT team confirmation here
        if (match.id === "F-QF3") return statusOf("F-R1") === "final";
        if (match.id === "F-QF4") return statusOf("F-R2") === "final";

        // SFs wait for their QFs
        if (match.id === "F-SF1")
            return ["F-QF1", "F-QF3"].every((x) => statusOf(x) === "final");
        if (match.id === "F-SF2")
            return ["F-QF2", "F-QF4"].every((x) => statusOf(x) === "final");

        // Bronze/Final wait for both SFs
        if (/^F-(?:F1|B1)$/.test(match.id))
            return ["F-SF1", "F-SF2"].every((x) => statusOf(x) === "final");

        // Bonus waits for Final
        if (match.id === "F-BON1") return statusOf("F-F1") === "final";
    }

    return true;
}

function shouldShowMatch(match, allMatches) {
    const { competitor_a, competitor_b, match_type, status } = match;

    if (match_type === "qualifier") return true;
    if (status === "void") return false;
    if (!depsSatisfied(match, allMatches)) return false;

    const bothConfirmed =
        !isPlaceholder(competitor_a?.id, match) &&
        !isPlaceholder(competitor_b?.id, match);
    const hasStarted = status === "live" || status === "final";

    // Allow Basketball elims (QF/SF/B/F) to show once deps are met,
    // even if names are still BW1..BW8, BQF1W etc.
    if (match.event_id === "basketball3v3" && match_type !== "qualifier") {
        return true; // depsSatisfied already enforced above
    }

    // Allow Frisbee elims (R/QF/SF/F/BON) to show once deps are met,
    // even if names are still A1/B2 etc.
    if (match.event_id === "frisbee5v5" && match_type !== "qualifier") {
        return hasStarted || bothConfirmed || true; // depsSatisfied already true
    }

    // For Frisbee QF3/QF4: require BOTH dependency AND confirmed teams
    if (match.event_id === "frisbee5v5" && /^F-QF[34]$/.test(match.id)) {
        const bothConfirmed =
            !isPlaceholder(competitor_a?.id, match) &&
            !isPlaceholder(competitor_b?.id, match);
        return bothConfirmed;
    }

    return bothConfirmed || hasStarted;
}

function shouldShowGame3(matchId, allMatches) {
    // Only applies to BADMINTON series (Basketball uses single elimination)
    // Series game 3 patterns: S-F3, D-B3, S-SF1-3, D-SF2-3
    const isSeriesGame3 =
        matchId.match(/^[SD]-(F|B)3$/) || // Finals/Bronze game 3: S-F3, D-B3
        matchId.match(/^[SD]-SF\d+-3$/); // Semi game 3: S-SF1-3, D-SF2-3

    if (!isSeriesGame3) return true; // Not a badminton series game 3, always show

    // Find the series root
    let seriesRoot;
    if (matchId.includes("-SF")) {
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
    // Get the actual match type code from the ID (Q, QF, SF, etc.)
    const matchPart = matchId.split("-")[1] || "";

    // Check match types in correct order
    if (matchId.includes("-QF")) return 3;
    if (matchId.includes("-Q")) return 1;
    if (matchId.includes("-R")) return 2;
    if (matchId.includes("-SF")) return 4;
    if (matchId.includes("-BON")) return 7;
    if (matchId.includes("-B")) return 5;
    if (matchId.includes("-F")) return 6;

    return 8; // Anything else
}

function listen(eventId) {
    container.innerHTML = '<p class="p-4 text-gray-500">Loading…</p>';
    if(rankingContainer) rankingContainer.innerHTML = '<p class="p-4 text-gray-500">Calculating rankings…</p>';

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
            if (!shouldShowMatch(match, allMatches)) return false;

            if (match.id.endsWith("-3") || match.id.endsWith("3")) {
                return shouldShowGame3(match.id, allMatches);
            }
            return true;
        });

        // Sort the visible matches
        const sortedMatches = visibleMatches.sort((a, b) => {
            // First by match type priority (Q, R, QF, SF, B, F, BON)
            const aPriority = getMatchPriority(a.id);
            const bPriority = getMatchPriority(b.id);
            if (aPriority !== bPriority) return aPriority - bPriority;

            // Scheduled time first, then match number
            const timeCompare =
                a.scheduled_at.toMillis() - b.scheduled_at.toMillis();
            return (
                timeCompare ||
                extractMatchNumber(a.id) - extractMatchNumber(b.id)
            );
        });

        const rows = [];

        for (const match of sortedMatches) {
            // 🔥 Use event-scoped team name resolution
            const [red, blue] = await Promise.all([
                resolveTeamName(match.event_id, match.competitor_a.id),
                resolveTeamName(match.event_id, match.competitor_b.id),
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
        if(rankingContainer){
            const rankings = await computeRankings(eventId, allMatches);
            rankingContainer.innerHTML = rankingTable(eventId, rankings);
        }
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
