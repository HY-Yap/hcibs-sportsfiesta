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
    // TODO: Uncomment and modify these when other sports are confirmed
    // frisbee: {
    //     type: "single",
    //     prefix: "F",
    //     finals: ["F1"],
    //     bronze: ["B1"],
    // },
    // basketball: {
    //     type: "bo3",
    //     prefix: "B",
    //     finals: ["F1", "F2", "F3"],
    //     bronze: ["B1", "B2", "B3"],
    // },
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

        // Determine if this is finals or bronze series
        let seriesType = null;
        if (config.finals.includes(matchSuffix)) {
            seriesType = "finals";
        } else if (config.bronze.includes(matchSuffix)) {
            seriesType = "bronze";
        } else {
            return null; // not a finals/bronze match
        }

        try {
            // Check if the series is now decided
            const series = await seriesState(sport, seriesType);
            if (!series.decided) {
                console.log(`${sport} ${seriesType} series not yet decided`);
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
        } catch (error) {
            console.error(
                `❌ [autoFillAwards] Error processing ${sport} ${seriesType}:`,
                error
            );
            throw error; // Re-throw to trigger Cloud Functions retry
        }

        return null;
    });
