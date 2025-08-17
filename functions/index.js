/*  Cloud Functions for Sports Fiesta
    ---------------------------------
    • propagateDelay – shift later matches if one starts late
    • autoFillAwards – auto-populate awards/{sport} when series are decided
*/

const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

/* ───────── propagateDelay (unchanged) ───────── */
exports.propagateDelay = functions.firestore
    .document("matches/{matchId}")
    .onUpdate(async (chg, _) => {
        const before = chg.before.data(),
            after = chg.after.data();
        if (before.status !== "scheduled" || after.status !== "live")
            return null;

        const delay =
            after.actual_start.toMillis() - after.scheduled_at.toMillis();
        if (delay <= 0) return null;

        const later = await db
            .collection("matches")
            .where("event_id", "==", after.event_id)
            .where("venue", "==", after.venue)
            .where("scheduled_at", ">", after.scheduled_at)
            .get();

        const batch = db.batch();
        later.forEach((doc) => {
            const newTS = new admin.firestore.Timestamp(
                doc.data().scheduled_at.toMillis() / 1000 + delay / 1000,
                0
            );
            batch.update(doc.ref, { scheduled_at: newTS });
        });

        console.log(
            `⏩ shifted ${later.size} matches on ${after.venue} by ${
                delay / 60000
            } min`
        );
        return batch.commit();
    });

/* ───────── auto-fill awards for different sports ───────── */

/**
 * Event Format Configuration
 *
 * CURRENT SPORTS (implemented):
 * - badminton_singles: S-F1, S-F2, S-F3 (finals) + S-B1, S-B2, S-B3 (bronze) - Best of 3
 * - badminton_doubles: D-F1, D-F2, D-F3 (finals) + D-B1, D-B2, D-B3 (bronze) - Best of 3
 *
 * FUTURE SPORTS (add when confirmed):
 * To add a new sport, update EVENT_FORMATS with:
 * - type: "bo3" (best of 3), "bo5" (best of 5), "single" (one match only)
 * - prefix: match ID prefix (e.g., "FB" for football)
 * - finals: array of final match suffixes
 * - bronze: array of bronze match suffixes
 *
 * Examples for future sports:
 * - frisbee: { type: "single", prefix: "FR", finals: ["FINAL"], bronze: ["BRONZE"] }
 * - volleyball: { type: "bo5", prefix: "V", finals: ["F1", "F2", "F3", "F4", "F5"], bronze: ["B1", "B2", "B3", "B4", "B5"] }
 * - football: { type: "single", prefix: "FB", finals: ["FINAL"], bronze: ["BRONZE"] }
 * - basketball: { type: "bo3", prefix: "BB", finals: ["F1", "F2", "F3"], bronze: ["B1", "B2", "B3"] }
 */
const EVENT_FORMATS = {
    badminton_singles: {
        type: "bo3",
        prefix: "S",
        finals: ["F1", "F2", "F3"],
        bronze: ["B1", "B2", "B3"],
    },
    badminton_doubles: {
        type: "bo3",
        prefix: "D",
        finals: ["F1", "F2", "F3"],
        bronze: ["B1", "B2", "B3"],
    },
    basketball3v3: {
        type: "single",
        prefix: "B",
        finals: ["F1"],
        bronze: ["B1"],
    },
    frisbee5v5: {
        type: "single",
        prefix: "F",
        finals: ["F1"],
        bronze: ["B1"],
    },
};

/**
 * Helper function to determine if a series is decided and who won
 * @param {string} eventId - The event ID (e.g., "badminton_singles")
 * @param {string} seriesType - Either "finals" or "bronze"
 * @returns {Promise<{decided: boolean, winnerRef?: object, loserRef?: object}>}
 */
async function seriesState(eventId, seriesType) {
    const config = EVENT_FORMATS[eventId];
    if (!config) return { decided: false }; // unsupported event

    const matchIds = seriesType === "finals" ? config.finals : config.bronze;
    const fullMatchIds = matchIds.map((id) => `${config.prefix}-${id}`);

    console.log(`🔍 Querying for matches:`, fullMatchIds);

    // Query all matches in this series
    const snap = await db
        .collection("matches")
        .where("event_id", "==", eventId)
        .where(admin.firestore.FieldPath.documentId(), "in", fullMatchIds)
        .get();

    console.log(`🔍 Found ${snap.size} matches for ${eventId} ${seriesType}`);

    if (config.type === "single") {
        // Single match format - just check if the match is final
        const match = snap.docs[0];
        if (!match || match.data().status !== "final") {
            return { decided: false };
        }

        const d = match.data();
        const refWinner =
            d.score_a > d.score_b ? d.competitor_a : d.competitor_b;
        const refLoser =
            d.score_a > d.score_b ? d.competitor_b : d.competitor_a;

        return { decided: true, winnerRef: refWinner, loserRef: refLoser };
    } else if (config.type === "bo3") {
        // Best-of-3 format - need 2 wins to decide
        return checkBestOfSeries(snap, 2);
    } else if (config.type === "bo5") {
        // Best-of-5 format - need 3 wins to decide
        return checkBestOfSeries(snap, 3);
    }

    return { decided: false };
}

/**
 * Helper function for best-of-X series logic
 * @param {QuerySnapshot} snap - Firestore query snapshot of matches
 * @param {number} winsNeeded - Number of wins needed to decide series
 * @returns {{decided: boolean, winnerRef?: object, loserRef?: object}}
 */
function checkBestOfSeries(snap, winsNeeded) {
    const wins = {}; // {teamId: winCount}
    const allTeams = new Set(); // Track all participating teams

    console.log(`🔍 Checking series: found ${snap.size} matches`);

    snap.forEach((doc) => {
        const d = doc.data();
        console.log(`🔍 Match ${doc.id}:`, {
            status: d.status,
            score_a: d.score_a,
            score_b: d.score_b,
            competitor_a_id: d.competitor_a?.id,
            competitor_b_id: d.competitor_b?.id,
        });

        if (d.status !== "final") return; // ignore unfinished games

        const aId = d.competitor_a.id;
        const bId = d.competitor_b.id;

        // Track all teams that participated
        allTeams.add(aId);
        allTeams.add(bId);

        // Handle tie case (though rare in badminton)
        if (d.score_a === d.score_b) {
            console.warn(
                `Tie detected in match ${doc.id}: ${d.score_a}-${d.score_b}`
            );
            return;
        }

        const winner = d.score_a > d.score_b ? aId : bId;
        wins[winner] = (wins[winner] || 0) + 1;

        console.log(`🔍 Winner of ${doc.id}: ${winner}, current wins:`, wins);
    });

    console.log(`🔍 Final win counts:`, wins);
    console.log(`🔍 Wins needed: ${winsNeeded}`);
    console.log(`🔍 All participating teams:`, Array.from(allTeams));

    // Check if any team has enough wins to decide the series
    const teams = Array.from(allTeams);
    if (teams.length < 2) {
        console.log(
            `🔍 Not enough different teams (${teams.length}), returning false`
        );
        return { decided: false };
    }

    // Find the team with the most wins
    let maxWins = 0;
    let winnerTeam = null;
    for (const team of teams) {
        const teamWins = wins[team] || 0;
        if (teamWins > maxWins) {
            maxWins = teamWins;
            winnerTeam = team;
        }
    }

    console.log(`🔍 Max wins: ${maxWins} by team: ${winnerTeam}`);

    if (maxWins >= winsNeeded) {
        console.log(
            `🔍 Series decided! ${winnerTeam} has >= ${winsNeeded} wins`
        );

        // Find the loser (the other team)
        const loserTeam = teams.find((team) => team !== winnerTeam);

        // Get full competitor refs from any finished match
        const anyDoc = snap.docs.find((d) => d.data().status === "final");
        if (!anyDoc) return { decided: false };

        const matchData = anyDoc.data();
        const refWinner = [matchData.competitor_a, matchData.competitor_b].find(
            (c) => c.id === winnerTeam
        );
        const refLoser = [matchData.competitor_a, matchData.competitor_b].find(
            (c) => c.id === loserTeam
        );

        return { decided: true, winnerRef: refWinner, loserRef: refLoser };
    } else {
        console.log(
            `🔍 Series not decided, no team has ${winsNeeded} wins yet`
        );
    }

    return { decided: false };
}

/**
 * Cloud Function that automatically fills awards when finals/bronze series are completed
 *
 * HOW TO ADD NEW SPORTS:
 * 1. Add the sport configuration to EVENT_FORMATS above
 * 2. Deploy the function
 * 3. The function will automatically handle the new sport based on its configuration
 *
 * AWARDS STRUCTURE:
 * - Finals winner → champion
 * - Finals loser → first_runner_up
 * - Bronze winner → second_runner_up
 */
exports.autoFillAwards = functions.firestore
    .document("matches/{matchId}")
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();

        // Only trigger when a match changes from "live" to "final"
        if (!(before.status === "live" && after.status === "final")) {
            return null;
        }

        const sport = after.event_id;
        const gameID = context.params.matchId;

        // Check if this event is configured
        const config = EVENT_FORMATS[sport];
        if (!config) {
            console.log(`Event ${sport} not configured for auto-awards`);
            return null;
        }

        // Parse match ID based on event format (e.g., "D-F1" -> ["D", "F1"])
        const parts = gameID.split("-");
        if (parts.length !== 2 || parts[0] !== config.prefix) {
            return null; // not a match we care about
        }

        const matchSuffix = parts[1]; // "F1", "FINAL", "BRONZE", etc.

        // Determine if this is finals or bronze match
        let seriesType = null;
        if (config.finals.includes(matchSuffix)) {
            seriesType = "finals";
        } else if (config.bronze.includes(matchSuffix)) {
            seriesType = "bronze";
        } else {
            return null; // not a finals/bronze match
        }

        console.log(`🏆 Processing ${sport} ${seriesType} match: ${gameID}`);

        try {
            // Handle single-game vs series formats differently
            if (config.type === "single") {
                // Single-game format: this match result IS the series result
                const aId = after.competitor_a?.id;
                const bId = after.competitor_b?.id;

                if (
                    !aId ||
                    !bId ||
                    typeof after.score_a !== "number" ||
                    typeof after.score_b !== "number"
                ) {
                    console.log(`❌ Invalid match data for ${gameID}`);
                    return null;
                }

                const winnerId = after.score_a > after.score_b ? aId : bId;
                const loserId = winnerId === aId ? bId : aId;

                const winnerRef = { id: winnerId };
                const loserRef = { id: loserId };

                // Build the awards object based on match type
                const awardSlots =
                    seriesType === "finals"
                        ? {
                              champion: winnerRef,
                              first_runner_up: loserRef,
                          }
                        : {
                              second_runner_up: winnerRef,
                          };

                // Update the awards document
                await db.doc(`awards/${sport}`).set(
                    {
                        ...awardSlots,
                        updated_at: FieldValue.serverTimestamp(),
                        published: false,
                    },
                    { merge: true }
                );

                console.log(
                    `✅ [autoFillAwards] ${sport} – ${seriesType} single match decided, awards updated`
                );
            } else {
                // Series format (bo3, bo5): check if the series is now decided
                const series = await seriesState(sport, seriesType);
                if (!series.decided) {
                    console.log(
                        `${sport} ${seriesType} series not yet decided`
                    );
                    return null;
                }

                // Build the awards object based on series type
                const awardSlots =
                    seriesType === "finals"
                        ? {
                              champion: series.winnerRef,
                              first_runner_up: series.loserRef,
                          }
                        : {
                              second_runner_up: series.winnerRef,
                          };

                // Update the awards document
                await db.doc(`awards/${sport}`).set(
                    {
                        ...awardSlots,
                        updated_at: FieldValue.serverTimestamp(),
                        published: false,
                    },
                    { merge: true }
                );

                console.log(
                    `✅ [autoFillAwards] ${sport} – ${seriesType} series decided, awards updated`
                );
            }
        } catch (error) {
            console.error(
                `❌ [autoFillAwards] Error processing ${sport} ${seriesType}:`,
                error
            );
            throw error; // Re-throw to trigger Cloud Functions retry
        }

        return null;
    });

/* ───────── publishAwards – set published:true when all slots filled ───────── */
exports.publishAwards = functions.firestore
    .document("awards/{eventId}")
    .onWrite(async (change, ctx) => {
        const after = change.after.exists ? change.after.data() : null;
        if (!after || after.published) return null; // already public

        const ready =
            after.champion && after.first_runner_up && after.second_runner_up;

        if (!ready) return null;

        await change.after.ref.update({
            published: true,
            published_at: FieldValue.serverTimestamp(),
        });

        console.log(`🏅 Awards for ${ctx.params.eventId} published`);
        return null;
    });

/* ───────── revealSemis (badminton) – generate SF brackets when all qualifiers are done ─────────
   Flow:
   1. Fires on any qualifier going live ➜ final.
   2. Checks if *every* qualifier in the same event is now final.
   3. Builds standings per pool (A / B) using:      wins ➜ point-diff.
   4. Determines seeds 1–4 and writes them into the pre-seeded SF placeholders:
        Bracket 1  ➜  #1 vs #4     (SF1-1, SF1-2, …)
        Bracket 2  ➜  #2 vs #3     (SF2-1, SF2-2, …)
   5. Only runs once – if semis already have real team IDs we skip.
   Tie-breaker reference is copied here for visibility.
*/
exports.revealSemis = functions.firestore
    .document("matches/{matchId}")
    .onUpdate(async (chg, ctx) => {
        const before = chg.before.data();
        const after = chg.after.data();

        /* Trigger only when a *qualifier* flips live ➜ final */
        if (!(before.status === "live" && after.status === "final"))
            return null;
        if (!after.match_type || after.match_type !== "qualifier") return null;

        const eventId = after.event_id;
        console.log(`🏁 Qualifier finished in ${eventId}:`, ctx.params.matchId);

        /* 1️⃣ — get ALL qualifiers for this event */
        const qualsSnap = await db
            .collection("matches")
            .where("event_id", "==", eventId)
            .where("match_type", "==", "qualifier")
            .get();

        /* Abort if some qualifiers still live/scheduled */
        const unfinished = qualsSnap.docs.filter(
            (d) => d.data().status !== "final"
        );
        if (unfinished.length) {
            console.log(
                `⏳ Not all qualifiers done – ${unfinished.length} remain`
            );
            return null;
        }

        /* 2️⃣ — build standings per pool */
        const pools = {}; // e.g. { A: { teamId: {W,DIF}}, B:{…} }
        for (const doc of qualsSnap.docs) {
            const d = doc.data();
            const pool = d.pool || "A"; // default safety
            pools[pool] ??= {};
            const a = d.competitor_a.id,
                b = d.competitor_b.id;
            const sa = d.score_a,
                sb = d.score_b;

            /* Update helper */
            const upd = (id, win, diff) => {
                const t = pools[pool][id] ?? { wins: 0, diff: 0 };
                t.wins += win;
                t.diff += diff;
                pools[pool][id] = t;
            };

            if (sa > sb) {
                upd(a, 1, sa - sb);
                upd(b, 0, sb - sa);
            } else if (sb > sa) {
                upd(b, 1, sb - sa);
                upd(a, 0, sa - sb);
            } else {
                upd(a, 0, 0);
                upd(b, 0, 0);
            } // tie unlikely
        }

        /* 3️⃣ — sort pools & pick seeds */
        const rank = (poolObj) =>
            Object.entries(poolObj)
                .sort(([, A], [, B]) => B.wins - A.wins || B.diff - A.diff)
                .map(([id]) => id);

        const topA = rank(pools["A"]).slice(0, 2); // [#1A,#2A]
        const topB = rank(pools["B"]).slice(0, 2); // [#1B,#2B]

        if (topA.length < 2 || topB.length < 2) {
            console.error("❌ Pool data incomplete, cannot seed semis");
            return null;
        }

        /* Seeds: 1=Winner A, 2=Winner B, 3=Runner-up A, 4=Runner-up B */
        const seed1 = topA[0],
            seed2 = topB[0],
            seed3 = topA[1],
            seed4 = topB[1];

        console.log("🔢 Seeds computed:", { seed1, seed2, seed3, seed4 });

        /* 4️⃣ — write into SF placeholders (only if still placeholders) */
        const bracket = [
            {
                idPrefix: `${EVENT_FORMATS[eventId].prefix}-SF1`,
                A: seed1,
                B: seed4,
                court: "Court 1",
            },
            {
                idPrefix: `${EVENT_FORMATS[eventId].prefix}-SF2`,
                A: seed2,
                B: seed3,
                court: "Court 2",
            },
        ];

        const batch = db.batch();
        for (const { idPrefix, A, B } of bracket) {
            const firstGame = await db.doc(`matches/${idPrefix}-1`).get();
            if (!firstGame.exists) {
                console.error(`❌ Missing doc ${idPrefix}-1`);
                continue;
            }
            const data = firstGame.data();
            if (data.competitor_a?.id === A && data.competitor_b?.id === B) {
                console.log(`↪️  Semis already seeded (${idPrefix}), skipping`);
                continue; // already real teams
            }
            // update all three games in the series
            for (let g = 1; g <= 3; g++) {
                batch.update(db.doc(`matches/${idPrefix}-${g}`), {
                    competitor_a: { id: A },
                    competitor_b: { id: B },
                    score_a: null,
                    score_b: null,
                    status: "scheduled",
                });
            }
        }
        await batch.commit();
        console.log("✅ Semi-final brackets revealed for", eventId);
        return null;
    });

/* ───────── revealBasketballElims – build QFs when all qualifiers are done ─────────
   Pools A/B/C/D, tiebreaker = wins → point-diff.
   Seeds = [W1=A1, W2=A2, W3=B1, W4=B2, W5=C1, W6=C2, W7=D1, W8=D2]
   QFs:
     QF1: W1 v W8 (Court 1, 17:20)
     QF2: W2 v W7 (Court 2, 17:20)
     QF3: W3 v W6 (Court 1, 17:30)
     QF4: W4 v W5 (Court 2, 17:30)
-------------------------------------------------------------------------------*/
exports.revealBasketballElims = functions.firestore
    .document("matches/{matchId}")
    .onUpdate(async (chg, ctx) => {
        const before = chg.before.data();
        const after = chg.after.data();

        console.log(`🏀 Basketball function triggered for ${ctx.params.matchId}`);
        console.log(`🏀 Status change: ${before.status} → ${after.status}`);
        console.log(`🏀 Event ID: ${after.event_id}, Match type: ${after.match_type}`);
        // Broaden trigger: any transition INTO final (scheduled/live/other -> final)
        if (after.status === 'final' && before.status !== 'final') {
            // proceed
        } else {
            console.log('🏀 Skip: not a transition into final');
            return null;
        }
        if (after.event_id !== "basketball3v3") {
            console.log(`🏀 Skipping: event_id is ${after.event_id}, not basketball3v3`);
            return null;
        }
        if (after.match_type !== "qualifier") {
            console.log(`🏀 Skipping: match_type is ${after.match_type}, not qualifier`);
            return null;
        }

        // 1) pull ALL qualifiers for basketball3v3
        const qualsSnap = await db
            .collection("matches")
            .where("event_id", "==", "basketball3v3")
            .where("match_type", "==", "qualifier")
            .get();

        const unfinished = qualsSnap.docs.filter(
            (d) => d.data().status !== "final"
        );
        if (unfinished.length) {
            console.log(`⏳ BB3v3: ${unfinished.length} qualifiers remaining`);
            return null;
        }

        // 2) standings per pool (wins → point-diff)
        const pools = {}; // { A:{team:{wins,diff}}, B:{…} }
        for (const doc of qualsSnap.docs) {
            const d = doc.data();
            const pool = d.pool; // expect "A"|"B"
            if (!pool) continue;
            pools[pool] ??= {};
            const a = d.competitor_a.id,
                b = d.competitor_b.id;
            const sa = d.score_a,
                sb = d.score_b;

            const upd = (id, win, diff) => {
                const t = pools[pool][id] ?? { wins: 0, diff: 0 };
                t.wins += win;
                t.diff += diff;
                pools[pool][id] = t;
            };

            if (sa > sb) {
                upd(a, 1, sa - sb);
                upd(b, 0, sb - sa);
            } else if (sb > sa) {
                upd(b, 1, sb - sa);
                upd(a, 0, sa - sb);
            } else {
                upd(a, 0, 0);
                upd(b, 0, 0);
            } // ties unlikely
        }

        const rank = (obj) =>
            Object.entries(obj)
                .sort(([, A], [, B]) => B.wins - A.wins || B.diff - A.diff)
                .map(([id]) => id);

        const A = rank(pools["A"] || {}),
            B = rank(pools["B"] || {});

        if ([A, B].some((arr) => arr.length < 2)) {
            console.error("❌ BB3v3 pools incomplete, cannot seed SFs");
            return null;
        }

        // 3) top 2 from each pool advance to semis
        const A1 = A[0], A2 = A[1], B1 = B[0], B2 = B[1];
        console.log("🏀 Semi Seeds:", { A1, A2, B1, B2 });

        // 4) write SF teams if still placeholders or missing
        const sf1Ref = db.doc('matches/B-SF1');
        const sf2Ref = db.doc('matches/B-SF2');
        const [sf1Doc, sf2Doc] = await Promise.all([sf1Ref.get(), sf2Ref.get()]);

        const needsUpdate = (docSnap) => {
            if (!docSnap.exists) return false;
            const d = docSnap.data();
            const aId = d.competitor_a?.id; const bId = d.competitor_b?.id;
            const isPlaceholder = (id) => !id || /^B(QF|SF)/.test(id) || /^BW[1-8]$/.test(id);
            return isPlaceholder(aId) || isPlaceholder(bId);
        };

        if (!needsUpdate(sf1Doc) && !needsUpdate(sf2Doc)) {
            console.log('🏀 Semis already seeded, skipping update');
            return null;
        }

        const batch = db.batch();
        if (needsUpdate(sf1Doc)) batch.update(sf1Ref, { competitor_a: {id: A1}, competitor_b: {id: B2}, score_a: null, score_b: null, status: 'scheduled' });
        if (needsUpdate(sf2Doc)) batch.update(sf2Ref, { competitor_a: {id: B1}, competitor_b: {id: A2}, score_a: null, score_b: null, status: 'scheduled' });
        await batch.commit();
        console.log('✅ BB3v3: Semis seeded');
        return null;
    });

// reveal frisbee elims
exports.revealFrisbeeElims = functions.firestore
    .document("matches/{matchId}")
    .onUpdate(async (chg, ctx) => {
        const before = chg.before.data(),
            after = chg.after.data();
        
        console.log(`🥏 Frisbee function triggered for ${ctx.params.matchId}`);
        console.log(`🥏 Status change: ${before.status} → ${after.status}`);
        console.log(`🥏 Event ID: ${after.event_id}, Match type: ${after.match_type}`);
        // Broaden trigger just like basketball
        if (!(after.status === 'final' && before.status !== 'final')) {
            console.log('🥏 Skip: not a transition into final');
            return null;
        }
        if (after.event_id !== "frisbee5v5") {
            console.log(`🥏 Skipping: event_id is ${after.event_id}, not frisbee5v5`);
            return null;
        }
        if (after.match_type !== "qualifier") {
            console.log(`🥏 Skipping: match_type is ${after.match_type}, not qualifier`);
            return null;
        }

        // pull ALL frisbee qualifiers
        const qualsSnap = await db
            .collection("matches")
            .where("event_id", "==", "frisbee5v5")
            .where("match_type", "==", "qualifier")
            .get();

        // wait until every qual is final
        const remaining = qualsSnap.docs.filter(
            (d) => d.data().status !== "final"
        );
        if (remaining.length) return null;

        // single round robin standings (all 7 teams)
        const standings = {}; // { teamId: {wins, diff} }
        
        for (const doc of qualsSnap.docs) {
            const d = doc.data();
            const a = d.competitor_a.id,
                b = d.competitor_b.id;
            const sa = d.score_a,
                sb = d.score_b;

            const upd = (id, win, diff) => {
                const t = standings[id] ?? { wins: 0, diff: 0 };
                t.wins += win;
                t.diff += diff;
                standings[id] = t;
            };

            if (sa > sb) {
                upd(a, 1, sa - sb);
                upd(b, 0, sb - sa);
            } else if (sb > sa) {
                upd(b, 1, sb - sa);
                upd(a, 0, sa - sb);
            } else {
                upd(a, 0, 0);
                upd(b, 0, 0);
            }
        }

        // rank all teams by wins, then point difference
        const ranked = Object.entries(standings)
            .sort(([, a], [, b]) => b.wins - a.wins || b.diff - a.diff)
            .map(([id]) => id);

        if (ranked.length < 4) {
            console.error("❌ frisbee: insufficient teams for elimination");
            return null;
        }

        const first = ranked[0],   // 1st place
            second = ranked[1],    // 2nd place  
            third = ranked[2],     // 3rd place
            fourth = ranked[3];    // 4th place

        console.log("🥏 Frisbee final standings:", { first, second, third, fourth });

        const bRef = db.doc('matches/F-B1');
        const fRef = db.doc('matches/F-F1');
        const [bDoc, fDoc] = await Promise.all([bRef.get(), fRef.get()]);
        const isPlace = (id) => !id || /^FSF[12][WL]$/.test(id) || /^FR[12]W$/.test(id);
        const needB = !bDoc.exists || isPlace(bDoc.data().competitor_a?.id) || isPlace(bDoc.data().competitor_b?.id);
        const needF = !fDoc.exists || isPlace(fDoc.data().competitor_a?.id) || isPlace(fDoc.data().competitor_b?.id);
        if(!needB && !needF){
            console.log('🥏 Bronze/final already seeded, skipping');
            return null;
        }
        const batch = db.batch();
        if(needB) batch.update(bRef, { competitor_a: {id: third}, competitor_b: {id: fourth}, score_a: null, score_b: null, status: 'scheduled' });
        if(needF) batch.update(fRef, { competitor_a: {id: first}, competitor_b: {id: second}, score_a: null, score_b: null, status: 'scheduled' });
        await batch.commit();
        console.log('✅ frisbee: bronze/final seeded');
        return null;
    });

// ───────── Manual reseed callable (basketball & frisbee) ─────────
exports.reseedElims = functions.https.onCall(async (data, context) => {
    const { sport } = data || {};
    if(!sport || !['basketball3v3','frisbee5v5'].includes(sport)){
        return { ok:false, error:'sport must be basketball3v3 or frisbee5v5'};
    }
    if(sport === 'basketball3v3'){
        // mimic logic above without needing an update trigger
        const qualsSnap = await db.collection('matches').where('event_id','==','basketball3v3').where('match_type','==','qualifier').get();
        if(!qualsSnap.docs.every(d=>d.data().status==='final')) return { ok:false, error:'qualifiers not all final'};
        const pools = {};
        for(const doc of qualsSnap.docs){
            const d = doc.data();
            if(!d.pool) continue; const pool=d.pool; pools[pool]??={};
            const a=d.competitor_a.id,b=d.competitor_b.id,sa=d.score_a,sb=d.score_b;
            const upd=(id,win,diff)=>{ const t=pools[pool][id]??{wins:0,diff:0}; t.wins+=win; t.diff+=diff; pools[pool][id]=t; };
            if(sa>sb){upd(a,1,sa-sb);upd(b,0,sb-sa);} else if(sb>sa){upd(b,1,sb-sa);upd(a,0,sa-sb);} else {upd(a,0,0);upd(b,0,0);} }
        const rank=obj=>Object.entries(obj).sort(([,A],[,B])=>B.wins-A.wins||B.diff-A.diff).map(([id])=>id);
        const A=rank(pools['A']||{}),B=rank(pools['B']||{}); if(A.length<2||B.length<2) return { ok:false, error:'not enough teams ranked'};
        const [A1,A2,B1,B2]=[A[0],A[1],B[0],B[1]];
        const sf1Ref=db.doc('matches/B-SF1'); const sf2Ref=db.doc('matches/B-SF2');
        const batch=db.batch(); batch.update(sf1Ref,{competitor_a:{id:A1},competitor_b:{id:B2},score_a:null,score_b:null,status:'scheduled'}); batch.update(sf2Ref,{competitor_a:{id:B1},competitor_b:{id:A2},score_a:null,score_b:null,status:'scheduled'}); await batch.commit();
        return { ok:true, seeded:{A1,A2,B1,B2} };
    }
    if(sport === 'frisbee5v5'){
        const qualsSnap = await db.collection('matches').where('event_id','==','frisbee5v5').where('match_type','==','qualifier').get();
        if(!qualsSnap.docs.every(d=>d.data().status==='final')) return { ok:false, error:'qualifiers not all final'};
        const standings={};
        for(const doc of qualsSnap.docs){ const d=doc.data(); const a=d.competitor_a.id,b=d.competitor_b.id,sa=d.score_a,sb=d.score_b; const upd=(id,win,diff)=>{ const t=standings[id]??{wins:0,diff:0}; t.wins+=win; t.diff+=diff; standings[id]=t; }; if(sa>sb){upd(a,1,sa-sb);upd(b,0,sb-sa);} else if(sb>sa){upd(b,1,sb-sa);upd(a,0,sa-b);} else {upd(a,0,0);upd(b,0,0);} }
        const ranked=Object.entries(standings).sort(([,a],[,b])=>b.wins-a.wins||b.diff-a.diff).map(([id])=>id); if(ranked.length<4) return { ok:false, error:'need at least 4 ranked'};
        const [first,second,third,fourth]=[ranked[0],ranked[1],ranked[2],ranked[3]]; const batch=db.batch(); batch.update(db.doc('matches/F-B1'),{competitor_a:{id:third},competitor_b:{id:fourth},score_a:null,score_b:null,status:'scheduled'}); batch.update(db.doc('matches/F-F1'),{competitor_a:{id:first},competitor_b:{id:second},score_a:null,score_b:null,status:'scheduled'}); await batch.commit();
        return { ok:true, seeded:{first,second,third,fourth} };
    }
});

/* ───────── seriesWatcher (badminton) – progresses BO3 series & hides un-needed G3 ─────────
   ① Trigger: any series match ("semi" | "bronze" | "final") moves   live ➜ final
   ② When a team reaches 2 wins (best-of-3) it:
      • Removes game-3 placeholder if it hasn't started
      • Injects winner / loser IDs into the next-round placeholders
        –  Semi  ➜ bronze / final
        –  Bronze / Final  ➜ nothing further (handled by autoFillAwards)
   Works for any sport configured in EVENT_FORMATS with .type === "bo3"
-------------------------------------------------------------------------------*/

exports.seriesWatcher = functions.firestore
    .document("matches/{matchId}")
    .onUpdate(async (chg, ctx) => {
        // Helper function INSIDE the handler to ensure proper scope
        function isPlaceholder(teamId, match) {
            if (!teamId) return true;

            // Badminton finals/bronze placeholders
            if (/^(?:S|D)[FB]W\d+$/.test(teamId)) return true;

            // Basketball placeholders (seed & progression tags)
            if (/^BW[1-8]$/.test(teamId)) return true;
            if (/^B(?:QF[1-4]W|SF[12][WL])$/.test(teamId)) return true;

            // (Optional) badminton semi placeholders (S1..S4 / D1..D4)
            if (/^(?:S|D)[1-4]$/.test(teamId)) return true;

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

        const before = chg.before.data();
        const after = chg.after.data();

        /* fire only on live ➜ final and only for series games */
        if (!(before.status === "live" && after.status === "final"))
            return null;
        if (!["semi", "bronze", "final"].includes(after.match_type))
            return null;

        const eventId = after.event_id;
        const config = EVENT_FORMATS[eventId];
        if (!config || config.type !== "bo3") return null;

        const matchId = ctx.params.matchId;
        let seriesRoot, gameNumber;

        // Parse different match ID formats
        if (matchId.includes("-SF")) {
            // Semi format: S-SF1-1, S-SF1-2, S-SF1-3
            const parts = matchId.split("-");
            if (parts.length !== 3) return null;
            seriesRoot = `${parts[0]}-${parts[1]}`; // "S-SF1"
            gameNumber = parseInt(parts[2]);
        } else {
            // Finals/Bronze format: S-F1, S-F2, S-F3 or S-B1, S-B2, S-B3
            const match = matchId.match(/^([SD])-([FB])(\d+)$/);
            if (!match) return null;
            const [, prefix, type, num] = match;
            seriesRoot = `${prefix}-${type}`; // "S-F" or "S-B"
            gameNumber = parseInt(num);
        }

        console.log(
            `🎮 Processing ${matchId}: series=${seriesRoot}, game=${gameNumber}`
        );

        /* fetch all 3 games in this series */
        let gameRefs;
        if (seriesRoot.includes("-SF")) {
            // Semi format: S-SF1-1, S-SF1-2, S-SF1-3
            gameRefs = [1, 2, 3].map((g) =>
                db.doc(`matches/${seriesRoot}-${g}`)
            );
        } else {
            // Finals/Bronze format: S-F1, S-F2, S-F3
            gameRefs = [1, 2, 3].map((g) =>
                db.doc(`matches/${seriesRoot}${g}`)
            );
        }

        const gamesSnap = await db.getAll(...gameRefs);
        const games = gamesSnap
            .filter((d) => d.exists)
            .map((d) => ({ id: d.id, ...d.data() }));

        console.log(`🎮 Found ${games.length} games in series ${seriesRoot}`);

        if (games.length === 0) {
            console.error(`❌ No games found for series ${seriesRoot}`);
            return null;
        }

        /* tally wins */
        const winMap = {};
        const allTeams = new Set(); // Track all participating teams

        games.forEach((g) => {
            if (g.status !== "final") return;

            // Track all teams that participated
            allTeams.add(g.competitor_a.id);
            allTeams.add(g.competitor_b.id);

            if (g.score_a === g.score_b) return; // tie unlikely
            const winner =
                g.score_a > g.score_b ? g.competitor_a.id : g.competitor_b.id;
            winMap[winner] = (winMap[winner] || 0) + 1;
        });

        console.log(`🎮 Win map:`, winMap);
        console.log(`🎮 All teams:`, Array.from(allTeams));

        const decidedTeam = Object.entries(winMap).find(
            ([, wins]) => wins >= 2
        );
        if (!decidedTeam) {
            console.log(`🎮 Series ${seriesRoot} not decided yet`);
            return null;
        }

        const [winnerId] = decidedTeam;
        // Find loser from all participating teams, not just winMap keys
        const loserId = Array.from(allTeams).find((t) => t !== winnerId);

        console.log(
            `🏆 Series ${seriesRoot} decided: ${winnerId} beats ${loserId}`
        );

        /* hide game-3 if it hasn't started */
        const batch = db.batch();
        const g3 = games.find((g) => g.id.endsWith("3"));
        if (g3 && g3.status === "scheduled") {
            batch.update(db.doc(`matches/${g3.id}`), { status: "void" });
            console.log(`🚫 Voided unused game 3: ${g3.id}`);
        }

        /* pipe winners forward only for semis */
        if (seriesRoot.includes("-SF")) {
            const parts = seriesRoot.split("-");
            const prefix = parts[0]; // "S" or "D"
            const sfNum = parts[1]; // "SF1" or "SF2"

            try {
                // Check current state of finals and bronze to determine slots
                const finalRef = db.doc(`matches/${prefix}-F1`);
                const bronzeRef = db.doc(`matches/${prefix}-B1`);

                const [finalDoc, bronzeDoc] = await Promise.all([
                    finalRef.get(),
                    bronzeRef.get(),
                ]);

                if (!finalDoc.exists || !bronzeDoc.exists) {
                    console.error(
                        `❌ Missing final or bronze matches for ${prefix}`
                    );
                    await batch.commit(); // Still commit to void game 3
                    return null;
                }

                const finalData = finalDoc.data();
                const bronzeData = bronzeDoc.data();

                // Determine which slots to fill for BOTH finals and bronze
                let finalSlot, bronzeSlot;

                // Check finals for available slot
                if (isPlaceholder(finalData.competitor_a?.id)) {
                    finalSlot = "competitor_a";
                } else if (isPlaceholder(finalData.competitor_b?.id)) {
                    finalSlot = "competitor_b";
                } else {
                    console.log(`↪️ Finals already fully seeded, skipping`);
                    await batch.commit(); // Still commit to void game 3 if needed
                    return null;
                }

                // Check bronze for available slot (independent of finals)
                if (isPlaceholder(bronzeData.competitor_a?.id)) {
                    bronzeSlot = "competitor_a";
                } else if (isPlaceholder(bronzeData.competitor_b?.id)) {
                    bronzeSlot = "competitor_b";
                } else {
                    console.log(
                        `↪️ Bronze already fully seeded for finals slot`
                    );
                    // Still update finals even if bronze is full
                }

                // Update finals (winner goes to finals)
                for (let g = 1; g <= 3; g++) {
                    const ref = db.doc(`matches/${prefix}-F${g}`);
                    batch.update(ref, {
                        [finalSlot]: { id: winnerId },
                    });
                }

                // Update bronze (loser goes to bronze) - only if slot available
                if (bronzeSlot) {
                    for (let g = 1; g <= 3; g++) {
                        const ref = db.doc(`matches/${prefix}-B${g}`);
                        batch.update(ref, {
                            [bronzeSlot]: { id: loserId },
                        });
                    }
                }

                console.log(
                    `🔄 Updated finals[${finalSlot}]=${winnerId} and bronze[${bronzeSlot}]=${loserId} with ${sfNum} results`
                );
            } catch (error) {
                console.error(`❌ Error updating finals/bronze:`, error);
                // Still commit batch to void game 3 if needed
            }
        }

        // ✅ CRITICAL: Actually commit the batch!
        try {
            await batch.commit();
            console.log(
                `✅ seriesWatcher: ${seriesRoot} completed → ${winnerId}`
            );
        } catch (error) {
            console.error(`❌ Error committing batch:`, error);
            throw error;
        }

        return null;
    });

/* ───────── advanceBasketballElims – single-game bracket progression ─────────
   Triggers when a B-QF* or B-SF* flips live ➜ final:
     • QF1 → SF1.A, QF2 → SF1.B, QF3 → SF2.A, QF4 → SF2.B
     • SF winners → F1.A / F1.B, losers → B1.A / B1.B
-------------------------------------------------------------------------------*/
exports.advanceBasketballElims = functions.firestore
    .document("matches/{matchId}")
    .onUpdate(async (chg, ctx) => {
        const before = chg.before.data();
        const after = chg.after.data();

        if (!(before.status === "live" && after.status === "final"))
            return null;
        if (after.event_id !== "basketball3v3") return null;
        if (!["semi"].includes(after.match_type)) return null; // Only handle semis now

        const id = ctx.params.matchId;
        const aId = after.competitor_a?.id,
            bId = after.competitor_b?.id;
        if (
            typeof after.score_a !== "number" ||
            typeof after.score_b !== "number"
        )
            return null;
        if (!aId || !bId) return null;

        const winnerId = after.score_a > after.score_b ? aId : bId;
        const loserId = winnerId === aId ? bId : aId;

        const batch = db.batch();

        // SFs: winners → Final, losers → Bronze
        const sfMatch = id.match(/^B-SF([1-2])$/);
        if (sfMatch) {
            const n = Number(sfMatch[1]);
            if (n === 1) {
                batch.update(db.doc("matches/B-F1"), {
                    competitor_a: { id: winnerId },
                });
                batch.update(db.doc("matches/B-B1"), {
                    competitor_a: { id: loserId },
                });
            } else {
                batch.update(db.doc("matches/B-F1"), {
                    competitor_b: { id: winnerId },
                });
                batch.update(db.doc("matches/B-B1"), {
                    competitor_b: { id: loserId },
                });
            }
            await batch.commit();
            console.log(
                `🏀 SF${n} → F1/B1 updated (W=${winnerId}, L=${loserId})`
            );
            return null;
        }

        return null;
    });

// advance frisbee elims
exports.advanceFrisbeeElims = functions.firestore
    .document("matches/{matchId}")
    .onUpdate(async (chg, ctx) => {
        const before = chg.before.data();
        const after = chg.after.data();
        // Broaden trigger: any transition into final
        if (!(after.status === 'final' && before.status !== 'final')) return null;
        if (after.event_id !== "frisbee5v5") return null;
        if (!["bronze", "final"].includes(after.match_type))
            return null;

        // Seed bonus match champion slot when final completes
        if (after.match_type === 'final') {
            try {
                const aId = after.competitor_a?.id;
                const bId = after.competitor_b?.id;
                if (aId && bId && typeof after.score_a === 'number' && typeof after.score_b === 'number') {
                    const winnerId = after.score_a > after.score_b ? aId : bId;
                    const bonusRef = db.doc('matches/F-BON1');
                    const bonusSnap = await bonusRef.get();
                    if (bonusSnap.exists) {
                        const curA = bonusSnap.data().competitor_a?.id;
                        if (!curA || curA === 'FCHAMP') {
                            await bonusRef.update({ competitor_a: { id: winnerId } });
                            console.log(`🥏 Bonus match champion slot set to ${winnerId}`);
                        } else {
                            console.log('🥏 Bonus match already has champion slot, skipping');
                        }
                    } else {
                        console.warn('🥏 Bonus match document F-BON1 not found');
                    }
                } else {
                    console.warn('🥏 Final match missing competitor IDs or scores; cannot seed bonus');
                }
            } catch (e) {
                console.error('❌ Error seeding bonus match champion slot:', e);
            }
        }

        console.log(`✅ frisbee: ${after.match_type} match completed (advancer run)`);
        return null;
    });
