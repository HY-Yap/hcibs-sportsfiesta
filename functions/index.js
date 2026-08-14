/*  Cloud Functions for Sports Fiesta
    ---------------------------------
    Match progression:
    
    QUALIFIERS
        ↓
    SEMIS (if applicable)
        ↓
    BRONZE + FINAL
        ↓
    AWARDS

    IMPORTANT:
    - Match document IDs and competitor placeholder IDs are different.
    - Elimination matches are initially hidden using status: "void".
    - Placeholder competitor IDs remain in those hidden documents.
    - Once the previous round is complete, only the next round is revealed.
*/

const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;


/* ============================================================
   1. EVENT CONFIGURATION
   ============================================================ */

/*
    Structure:

    match IDs:
      semis
      bronze
      finals

    placeholders:
      competitors used before actual teams are known

    groups:
      number of qualifier groups

    showThird:
      whether a bronze match is required
*/

const EVENT_FORMATS = {

    /* --------------------------------------------------------
       BASKETBALL 3v3
       -------------------------------------------------------- */

    basketball3v3: {
        groups: 2,
        hasSemis: true,
        showThird: true,

        semis: [
            "B-SF1",
            "B-SF2"
        ],

        bronze: [
            "B-B1"
        ],

        finals: [
            "B-F1"
        ],

        semiPlaceholders: [
            ["BQF1W", "BQF4W"],
            ["BQF2W", "BQF3W"]
        ],

        bronzePlaceholders: ["BSF1L", "BSF2L"],
        finalPlaceholders: ["BSF1W", "BSF2W"]
    },


    /* --------------------------------------------------------
       BADMINTON MEN'S SINGLES
       -------------------------------------------------------- */

    badminton_singles_male: {
        groups: 2,
        hasSemis: true,
        showThird: true,

        semis: [
            "SM-SF1",
            "SM-SF2"
        ],

        bronze: [
            "SM-B1"
        ],

        finals: [
            "SM-F1"
        ],

        /*
          Placeholder competitors:
            SMSF1
            SMSF2
            SMSF3
            SMSF4

          SMB1 / SMB2
          SMF1 / SMF2
        */

        semiPlaceholders: [
            ["SMSF1", "SMSF4"],
            ["SMSF2", "SMSF3"]
        ],

        bronzePlaceholders: ["SMB1", "SMB2"],
        finalPlaceholders: ["SMF1", "SMF2"]
    },


    /* --------------------------------------------------------
       BADMINTON MEN'S DOUBLES
       -------------------------------------------------------- */

    badminton_doubles_male: {
        groups: 2,
        hasSemis: true,
        showThird: true,

        semis: [
            "DM-SF1",
            "DM-SF2"
        ],

        bronze: [
            "DM-B1"
        ],

        finals: [
            "DM-F1"
        ],

        /*
          SDSF1
          SDSF2
          SDSF3
          SDSF4

          SDB1 / SDB2
          SDF1 / SDF2
        */

        semiPlaceholders: [
            ["SDSF1", "SDSF4"],
            ["SDSF2", "SDSF3"]
        ],

        bronzePlaceholders: ["SDB1", "SDB2"],
        finalPlaceholders: ["SDF1", "SDF2"]
    },


    /* --------------------------------------------------------
       BADMINTON WOMEN'S SINGLES
       -------------------------------------------------------- */

    badminton_singles_female: {
        groups: 2,
        hasSemis: false,
        showThird: false,

        semis: [],

        bronze: [],

        finals: [
            "SF-F1"
        ],

        /*
          Only 1st and 2nd are needed.
          No bronze.

          SFF1
          SFF2
        */

        finalPlaceholders: ["SFF1", "SFF2"]
    },


    /* --------------------------------------------------------
       BADMINTON WOMEN'S DOUBLES
       -------------------------------------------------------- */

    badminton_doubles_female: {
        groups: 2,
        hasSemis: false,
        showThird: false,

        semis: [],

        bronze: [],

        finals: [
            "DF-F1"
        ],

        /*
          DFF1
          DFF2
        */

        finalPlaceholders: ["DFF1", "DFF2"]
    },


    /* --------------------------------------------------------
       VOLLEYBALL
       -------------------------------------------------------- */

    volleyball: {
        groups: 2,
        hasSemis: true,
        showThird: true,

        semis: [
            "V-SF1",
            "V-SF2"
        ],

        bronze: [
            "V-B1"
        ],

        finals: [
            "V-F1"
        ],

        /*
          VSF1
          VSF2
          VSF3
          VSF4

          VBF1 / VBF2
          VF1 / VF2
        */

        semiPlaceholders: [
            ["VSF1", "VSF4"],
            ["VSF2", "VSF3"]
        ],

        bronzePlaceholders: ["VBF1", "VBF2"],
        finalPlaceholders: ["VF1", "VF2"]
    },


    /* --------------------------------------------------------
       FRISBEE 5v5
       -------------------------------------------------------- */

    frisbee5v5: {
        groups: 2,
        hasSemis: true,
        showThird: true,

        semis: [
            "F-SF1",
            "F-SF2"
        ],

        bronze: [
            "F-B1"
        ],

        finals: [
            "F-F1"
        ],

        /*
          FSF1
          FSF2
          FSF3
          FSF4

          FB1 / FB2
          FF1 / FF2
        */

        semiPlaceholders: [
            ["FSF1", "FSF4"],
            ["FSF2", "FSF3"]
        ],

        bronzePlaceholders: ["FB1", "FB2"],
        finalPlaceholders: ["FF1", "FF2"]
    }
};


/* ============================================================
   2. GENERAL HELPERS
   ============================================================ */

function getConfig(eventId) {
    return EVENT_FORMATS[eventId] || null;
}


function getWinner(match) {
    if (
        typeof match.score_a !== "number" ||
        typeof match.score_b !== "number"
    ) {
        return null;
    }

    if (match.score_a === match.score_b) {
        return null;
    }

    return match.score_a > match.score_b
        ? match.competitor_a?.id
        : match.competitor_b?.id;
}


function getLoser(match) {
    if (
        typeof match.score_a !== "number" ||
        typeof match.score_b !== "number"
    ) {
        return null;
    }

    if (match.score_a === match.score_b) {
        return null;
    }

    return match.score_a > match.score_b
        ? match.competitor_b?.id
        : match.competitor_a?.id;
}


function isFinalMatch(match) {
    return match && match.status === "final";
}


/*
   Hidden elimination matches use:
       status: "void"

   They become:
       status: "scheduled"

   when they are actually revealed.
*/
async function hideMatches(matchIds, placeholders = []) {
    const batch = db.batch();

    for (let i = 0; i < matchIds.length; i++) {
        const ref = db.doc(`matches/${matchIds[i]}`);
        const snap = await ref.get();

        if (!snap.exists) {
            console.warn(`⚠️ Missing match document ${matchIds[i]}`);
            continue;
        }

        const update = {
            status: "void",
            score_a: null,
            score_b: null
        };

        if (placeholders[i]) {
            update.competitor_a = {
                id: placeholders[i][0]
            };

            update.competitor_b = {
                id: placeholders[i][1]
            };
        }

        batch.update(ref, update);
    }

    await batch.commit();
}


/*
   Reveal a match.
*/
function revealMatch(batch, matchId, competitorA, competitorB) {
    batch.update(db.doc(`matches/${matchId}`), {
        competitor_a: {
            id: competitorA
        },
        competitor_b: {
            id: competitorB
        },
        score_a: null,
        score_b: null,
        status: "scheduled"
    });
}


/* ============================================================
   3. QUALIFIER STANDINGS
   ============================================================ */

/*
   Creates standings:

       {
           teamId: {
               wins,
               diff
           }
       }

   Tiebreak:
       wins → point difference
*/

function updateStanding(standings, id, win, diff) {
    if (!id) return;

    if (!standings[id]) {
        standings[id] = {
            wins: 0,
            diff: 0
        };
    }

    standings[id].wins += win;
    standings[id].diff += diff;
}


function addMatchToStandings(standings, match) {
    if (
        !match.competitor_a?.id ||
        !match.competitor_b?.id ||
        typeof match.score_a !== "number" ||
        typeof match.score_b !== "number"
    ) {
        return;
    }

    const a = match.competitor_a.id;
    const b = match.competitor_b.id;
    const sa = match.score_a;
    const sb = match.score_b;

    if (sa > sb) {
        updateStanding(standings, a, 1, sa - sb);
        updateStanding(standings, b, 0, sb - sa);
    } else if (sb > sa) {
        updateStanding(standings, b, 1, sb - sa);
        updateStanding(standings, a, 0, sa - sb);
    } else {
        updateStanding(standings, a, 0, 0);
        updateStanding(standings, b, 0, 0);
    }
}


function rankStandings(standings) {
    return Object.entries(standings)
        .sort(
            ([, a], [, b]) =>
                b.wins - a.wins ||
                b.diff - a.diff
        )
        .map(([id]) => id);
}


/* ============================================================
   4. GET ALL QUALIFIERS
   ============================================================ */

async function getQualifiers(eventId) {
    return db
        .collection("matches")
        .where("event_id", "==", eventId)
        .where("match_type", "==", "qualifier")
        .get();
}


function qualifiersComplete(snapshot) {
    return snapshot.docs.every(
        doc => doc.data().status === "final"
    );
}


/*
   Returns:

       {
           A: [1st, 2nd, 3rd, ...],
           B: [1st, 2nd, 3rd, ...]
       }

   if there are multiple groups.

   For one group:

       {
           ALL: [1st, 2nd, 3rd, 4th, ...]
       }
*/
function buildGroupStandings(snapshot) {
    const groups = {};

    snapshot.docs.forEach(doc => {
        const match = doc.data();

        const group = match.pool || match.group || "ALL";

        if (!groups[group]) {
            groups[group] = {};
        }

        addMatchToStandings(groups[group], match);
    });

    const ranked = {};

    for (const [group, standings] of Object.entries(groups)) {
        ranked[group] = rankStandings(standings);
    }

    return ranked;
}


/* ============================================================
   5. DETERMINE SEMI-FINAL TEAMS
   ============================================================ */

/*
   RULE:

   2 groups:
       A1 vs B2
       B1 vs A2

   1 group:
       1st vs 3rd
       2nd vs 4th
*/

function getSemiTeams(groupStandings) {
    const groups = Object.keys(groupStandings);

    /*
       One group
    */
    if (groups.length === 1) {
        const ranked = groupStandings[groups[0]];

        if (ranked.length < 4) {
            return null;
        }

        return [
            [ranked[0], ranked[2]],
            [ranked[1], ranked[3]]
        ];
    }

    /*
       Two groups
    */
    if (groups.length >= 2) {
        const firstGroup = groupStandings[groups[0]];
        const secondGroup = groupStandings[groups[1]];

        if (
            firstGroup.length < 2 ||
            secondGroup.length < 2
        ) {
            return null;
        }

        return [
            [firstGroup[0], secondGroup[1]],
            [secondGroup[0], firstGroup[1]]
        ];
    }

    return null;
}


/*
   For sports with NO semifinals:

       1st vs 2nd
*/
function getFinalTeams(groupStandings) {
    const groups = Object.keys(groupStandings);

    if (groups.length === 1) {
        const ranked = groupStandings[groups[0]];

        if (ranked.length < 2) {
            return null;
        }

        return [ranked[0], ranked[1]];
    }

    if (groups.length >= 2) {
        /*
           For two groups, overall ranking is determined by
           combining the group standings.

           We need the top two overall teams.
        */

        const combined = [];

        for (const group of groups) {
            for (const id of groupStandings[group]) {
                combined.push(id);
            }
        }

        /*
           In the normal two-group setup, finalists are
           the winners of each group.
        */

        const g1 = groupStandings[groups[0]];
        const g2 = groupStandings[groups[1]];

        if (g1.length < 1 || g2.length < 1) {
            return null;
        }

        return [g1[0], g2[0]];
    }

    return null;
}


/* ============================================================
   6. INITIALISE / HIDE ELIMINATION MATCHES
   ============================================================ */

/*
   This is the important fix for your current problem.

   Before qualifiers are complete:

       SEMIS      = void
       BRONZE     = void
       FINAL      = void

   Therefore none of them should appear as playable matches.
*/

exports.initialiseEliminationMatches =
    functions.firestore
        .document("matches/{matchId}")
        .onCreate(async (snap) => {

            const data = snap.data();
            const eventId = data.event_id;
            const config = getConfig(eventId);

            if (!config) {
                return null;
            }

            const matchId = snap.id;

            const allElims = [
                ...(config.semis || []),
                ...(config.bronze || []),
                ...(config.finals || [])
            ];

            if (!allElims.includes(matchId)) {
                return null;
            }

            /*
               Do not overwrite an already-started match.
            */
            if (
                data.status === "live" ||
                data.status === "final"
            ) {
                return null;
            }

            const update = {
                status: "void",
                score_a: null,
                score_b: null
            };

            await snap.ref.update(update);

            console.log(
                `🙈 Hidden elimination match ${matchId} for ${eventId}`
            );

            return null;
        });


/*
   This function handles existing documents too.

   When ANY qualifier changes, if qualifiers are not complete,
   all elimination rounds are forced back to hidden state.

   This prevents pre-created bronze/final documents from
   accidentally appearing.
*/

exports.hideEliminationsUntilQualifiersDone =
    functions.firestore
        .document("matches/{matchId}")
        .onUpdate(async (chg) => {

            const before = chg.before.data();
            const after = chg.after.data();

            if (
                after.match_type !== "qualifier" ||
                before.status === after.status
            ) {
                return null;
            }

            const eventId = after.event_id;
            const config = getConfig(eventId);

            if (!config) {
                return null;
            }

            const quals = await getQualifiers(eventId);

            if (qualifiersComplete(quals)) {
                return null;
            }

            const ids = [
                ...(config.semis || []),
                ...(config.bronze || []),
                ...(config.finals || [])
            ];

            const batch = db.batch();

            for (const id of ids) {
                const ref = db.doc(`matches/${id}`);
                const snap = await ref.get();

                if (!snap.exists) continue;

                const d = snap.data();

                /*
                   Do NOT hide a match which has already started.
                */
                if (
                    d.status === "live" ||
                    d.status === "final"
                ) {
                    continue;
                }

                batch.update(ref, {
                    status: "void",
                    score_a: null,
                    score_b: null
                });
            }

            await batch.commit();

            console.log(
                `🙈 ${eventId}: qualifiers incomplete; elimination matches hidden`
            );

            return null;
        });


/* ============================================================
   7. REVEAL SEMIS / DIRECT FINALS AFTER QUALIFIERS
   ============================================================ */

exports.revealEliminationsAfterQualifiers =
    functions.firestore
        .document("matches/{matchId}")
        .onUpdate(async (chg, ctx) => {

            const before = chg.before.data();
            const after = chg.after.data();

            /*
               Trigger when a qualifier becomes final.
            */
            if (
                after.match_type !== "qualifier" ||
                after.status !== "final" ||
                before.status === "final"
            ) {
                return null;
            }

            const eventId = after.event_id;
            const config = getConfig(eventId);

            if (!config) {
                return null;
            }

            console.log(
                `🏁 ${eventId}: qualifier ${ctx.params.matchId} completed`
            );

            const quals = await getQualifiers(eventId);

            /*
               CRITICAL:
               Do absolutely nothing until EVERY qualifier is final.
            */
            if (!qualifiersComplete(quals)) {
                console.log(
                    `⏳ ${eventId}: qualifiers are not all finished`
                );
                return null;
            }

            const groupStandings = buildGroupStandings(quals);

            console.log(
                `📊 ${eventId} standings:`,
                groupStandings
            );

            const batch = db.batch();


            /* ------------------------------------------------
               SPORT WITH SEMIS
               ------------------------------------------------ */

            if (config.hasSemis) {

                const semiTeams =
                    getSemiTeams(groupStandings);

                if (!semiTeams) {
                    console.error(
                        `❌ ${eventId}: insufficient teams for semifinals`
                    );
                    return null;
                }

                console.log(
                    `🔢 ${eventId} semi teams:`,
                    semiTeams
                );

                /*
                   Reveal ONLY the semifinals.

                   Bronze and final remain void.
                */

                for (
                    let i = 0;
                    i < config.semis.length;
                    i++
                ) {
                    const [a, b] = semiTeams[i];

                    revealMatch(
                        batch,
                        config.semis[i],
                        a,
                        b
                    );
                }

                /*
                   Explicitly keep downstream rounds hidden.
                */

                for (const id of [
                    ...(config.bronze || []),
                    ...(config.finals || [])
                ]) {

                    const ref =
                        db.doc(`matches/${id}`);

                    const snap = await ref.get();

                    if (!snap.exists) continue;

                    const d = snap.data();

                    if (
                        d.status !== "live" &&
                        d.status !== "final"
                    ) {
                        batch.update(ref, {
                            status: "void",
                            score_a: null,
                            score_b: null
                        });
                    }
                }

                await batch.commit();

                console.log(
                    `✅ ${eventId}: SEMIS revealed. Bronze/final remain hidden.`
                );

                return null;
            }


            /* ------------------------------------------------
               SPORT WITHOUT SEMIS
               ------------------------------------------------ */

            const finalTeams =
                getFinalTeams(groupStandings);

            if (!finalTeams) {
                console.error(
                    `❌ ${eventId}: insufficient teams for final`
                );
                return null;
            }

            const finalId = config.finals[0];

            revealMatch(
                batch,
                finalId,
                finalTeams[0],
                finalTeams[1]
            );

            await batch.commit();

            console.log(
                `🏆 ${eventId}: direct final revealed`
            );

            return null;
        });


/* ============================================================
   8. PROGRESS SEMIFINALS → BRONZE / FINAL
   ============================================================ */

exports.advanceSemifinals =
    functions.firestore
        .document("matches/{matchId}")
        .onUpdate(async (chg, ctx) => {

            const before = chg.before.data();
            const after = chg.after.data();

            /*
               Only react when a semifinal becomes final.
            */
            if (
                after.status !== "final" ||
                before.status === "final"
            ) {
                return null;
            }

            const eventId = after.event_id;
            const config = getConfig(eventId);

            if (!config || !config.hasSemis) {
                return null;
            }

            if (!config.semis.includes(ctx.params.matchId)) {
                return null;
            }

            const winner = getWinner(after);
            const loser = getLoser(after);

            if (!winner || !loser) {
                console.error(
                    `❌ ${eventId}: invalid semifinal result`
                );
                return null;
            }

            console.log(
                `🏆 ${eventId}: ${ctx.params.matchId} → W=${winner}, L=${loser}`
            );


            /*
               Check ALL semifinals.

               Bronze/final must NOT be revealed after only
               one semifinal.
            */

            const semiRefs =
                config.semis.map(id =>
                    db.doc(`matches/${id}`)
                );

            const semiSnaps =
                await db.getAll(...semiRefs);

            const allFinished =
                semiSnaps.every(
                    snap =>
                        snap.exists &&
                        snap.data().status === "final"
                );

            if (!allFinished) {
                console.log(
                    `⏳ ${eventId}: waiting for remaining semifinal`
                );
                return null;
            }


            /*
               Collect semifinal winners/losers.
            */

            const winners = [];
            const losers = [];

            for (const snap of semiSnaps) {
                const d = snap.data();

                const w = getWinner(d);
                const l = getLoser(d);

                if (!w || !l) {
                    console.error(
                        `❌ ${eventId}: invalid semifinal ${snap.id}`
                    );
                    return null;
                }

                winners.push(w);
                losers.push(l);
            }

            if (
                winners.length < 2 ||
                losers.length < 2
            ) {
                return null;
            }


            /*
               NOW — and only now —
               reveal bronze and final.
            */

            const batch = db.batch();


            /* ---------------- FINAL ---------------- */

            revealMatch(
                batch,
                config.finals[0],
                winners[0],
                winners[1]
            );


            /* ---------------- BRONZE ---------------- */

            if (
                config.showThird &&
                config.bronze &&
                config.bronze.length > 0
            ) {
                revealMatch(
                    batch,
                    config.bronze[0],
                    losers[0],
                    losers[1]
                );
            }


            await batch.commit();

            console.log(
                `✅ ${eventId}: semifinals complete`
            );

            console.log(
                `🏆 Final: ${winners[0]} vs ${winners[1]}`
            );

            if (config.showThird) {
                console.log(
                    `🥉 Bronze: ${losers[0]} vs ${losers[1]}`
                );
            }

            return null;
        });


/* ============================================================
   9. BASKETBALL 3v3
   ============================================================ */

/*
   Basketball is intentionally retained separately.

   Qualifiers:
       Group A
       Group B

   Semis:
       A1 vs B2
       B1 vs A2

   B-SF1 winner → B-F1 A
   B-SF2 winner → B-F1 B

   B-SF1 loser → B-B1 A
   B-SF2 loser → B-B1 B
*/

exports.advanceBasketballElims =
    functions.firestore
        .document("matches/{matchId}")
        .onUpdate(async (chg, ctx) => {

            const before = chg.before.data();
            const after = chg.after.data();

            if (
                before.status !== "live" ||
                after.status !== "final"
            ) {
                return null;
            }

            if (
                after.event_id !== "basketball3v3"
            ) {
                return null;
            }

            if (
                after.match_type !== "semi"
            ) {
                return null;
            }

            const id = ctx.params.matchId;

            const winner = getWinner(after);
            const loser = getLoser(after);

            if (!winner || !loser) {
                return null;
            }

            const match = id.match(
                /^B-SF([1-2])$/
            );

            if (!match) {
                return null;
            }

            const n = Number(match[1]);

            const batch = db.batch();

            if (n === 1) {

                batch.update(
                    db.doc("matches/B-F1"),
                    {
                        competitor_a: {
                            id: winner
                        },
                        status: "scheduled"
                    }
                );

                batch.update(
                    db.doc("matches/B-B1"),
                    {
                        competitor_a: {
                            id: loser
                        },
                        status: "scheduled"
                    }
                );

            } else {

                batch.update(
                    db.doc("matches/B-F1"),
                    {
                        competitor_b: {
                            id: winner
                        },
                        status: "scheduled"
                    }
                );

                batch.update(
                    db.doc("matches/B-B1"),
                    {
                        competitor_b: {
                            id: loser
                        },
                        status: "scheduled"
                    }
                );
            }

            await batch.commit();

            console.log(
                `🏀 B-SF${n}: W=${winner}, L=${loser}`
            );

            return null;
        });


/* ============================================================
   10. AWARDS
   ============================================================ */

/*
   Awards:

   Champion:
       final winner

   First runner-up:
       final loser

   Second runner-up:
       bronze winner

   Female badminton:
       no bronze
       therefore no second_runner_up required
*/


function awardConfig(eventId) {

    const config = getConfig(eventId);

    if (!config) {
        return null;
    }

    return {
        needsThird:
            config.showThird === true
    };
}


async function updateAward(eventId, slot, competitorId) {

    if (!competitorId) {
        return;
    }

    await db.doc(`awards/${eventId}`).set(
        {
            [slot]: {
                id: competitorId
            },

            updated_at:
                FieldValue.serverTimestamp(),

            published: false
        },
        {
            merge: true
        }
    );
}


/*
   Process final / bronze results.
*/

exports.autoFillAwards =
    functions.firestore
        .document("matches/{matchId}")
        .onUpdate(async (chg, ctx) => {

            const before = chg.before.data();
            const after = chg.after.data();

            if (
                after.status !== "final" ||
                before.status === "final"
            ) {
                return null;
            }

            const eventId = after.event_id;
            const config = getConfig(eventId);

            if (!config) {
                return null;
            }

            const id = ctx.params.matchId;

            /*
               Only final or bronze matches.
            */

            const isFinal =
                config.finals.includes(id);

            const isBronze =
                config.bronze &&
                config.bronze.includes(id);

            if (!isFinal && !isBronze) {
                return null;
            }

            const winner = getWinner(after);
            const loser = getLoser(after);

            if (!winner || !loser) {
                return null;
            }


            /* ---------------- FINAL ---------------- */

            if (isFinal) {

                await db.doc(`awards/${eventId}`).set(
                    {
                        champion: {
                            id: winner
                        },

                        first_runner_up: {
                            id: loser
                        },

                        updated_at:
                            FieldValue.serverTimestamp(),

                        published: false
                    },
                    {
                        merge: true
                    }
                );

                console.log(
                    `🏆 ${eventId}: champion=${winner}, runner-up=${loser}`
                );
            }


            /* ---------------- BRONZE ---------------- */

            if (isBronze) {

                await updateAward(
                    eventId,
                    "second_runner_up",
                    winner
                );

                console.log(
                    `🥉 ${eventId}: third place=${winner}`
                );
            }

            return null;
        });


/* ============================================================
   11. PUBLISH AWARDS
   ============================================================ */

exports.publishAwards =
    functions.firestore
        .document("awards/{eventId}")
        .onWrite(async (change, ctx) => {

            if (!change.after.exists) {
                return null;
            }

            const data =
                change.after.data();

            if (data.published === true) {
                return null;
            }

            const eventId =
                ctx.params.eventId;

            const config =
                awardConfig(eventId);

            if (!config) {
                return null;
            }


            /*
               Every event needs:

                   champion
                   first_runner_up
            */

            const basicReady =
                data.champion &&
                data.first_runner_up;

            if (!basicReady) {
                return null;
            }


            /*
               Only sports with bronze require
               second_runner_up.
            */

            if (
                config.needsThird &&
                !data.second_runner_up
            ) {
                return null;
            }


            await change.after.ref.update(
                {
                    published: true,

                    published_at:
                        FieldValue.serverTimestamp()
                }
            );

            console.log(
                `🏅 Awards for ${eventId} published`
            );

            return null;
        });


/* ============================================================
   12. PROPAGATE DELAY
   ============================================================ */

exports.propagateDelay =
    functions.firestore
        .document("matches/{matchId}")
        .onUpdate(async (chg) => {

            const before =
                chg.before.data();

            const after =
                chg.after.data();

            if (
                before.status !== "scheduled" ||
                after.status !== "live"
            ) {
                return null;
            }

            if (
                !after.actual_start ||
                !after.scheduled_at
            ) {
                return null;
            }

            const delay =
                after.actual_start.toMillis() -
                after.scheduled_at.toMillis();

            if (delay <= 0) {
                return null;
            }

            const later =
                await db
                    .collection("matches")
                    .where(
                        "event_id",
                        "==",
                        after.event_id
                    )
                    .where(
                        "venue",
                        "==",
                        after.venue
                    )
                    .where(
                        "scheduled_at",
                        ">",
                        after.scheduled_at
                    )
                    .get();

            const batch =
                db.batch();

            later.forEach(doc => {

                const old =
                    doc.data()
                        .scheduled_at;

                const newTS =
                    new admin.firestore.Timestamp(
                        old.toMillis() / 1000 +
                        delay / 1000,
                        0
                    );

                batch.update(
                    doc.ref,
                    {
                        scheduled_at:
                            newTS
                    }
                );
            });

            console.log(
                `⏩ shifted ${later.size} matches on ${after.venue} by ${
                    delay / 60000
                } min`
            );

            return batch.commit();
        });


/* ============================================================
   13. MANUAL RESEED
   ============================================================ */

exports.reseedElims =
    functions.https.onCall(async (data) => {

        const sport =
            data?.sport;

        const config =
            getConfig(sport);

        if (!config) {
            return {
                ok: false,
                error: "Unknown sport"
            };
        }


        const quals =
            await getQualifiers(sport);

        if (!qualifiersComplete(quals)) {
            return {
                ok: false,
                error:
                    "Qualifiers are not all final"
            };
        }


        const standings =
            buildGroupStandings(quals);

        const batch =
            db.batch();


        /* ------------------------------------------------
           SPORTS WITH SEMIS
           ------------------------------------------------ */

        if (config.hasSemis) {

            const semiTeams =
                getSemiTeams(standings);

            if (!semiTeams) {
                return {
                    ok: false,
                    error:
                        "Not enough teams for semifinals"
                };
            }

            for (
                let i = 0;
                i < config.semis.length;
                i++
            ) {

                revealMatch(
                    batch,
                    config.semis[i],
                    semiTeams[i][0],
                    semiTeams[i][1]
                );
            }

            /*
               IMPORTANT:
               Bronze/final remain hidden.
            */

            for (const id of [
                ...(config.bronze || []),
                ...(config.finals || [])
            ]) {

                const ref =
                    db.doc(`matches/${id}`);

                const snap =
                    await ref.get();

                if (!snap.exists) continue;

                const d =
                    snap.data();

                if (
                    d.status !== "live" &&
                    d.status !== "final"
                ) {
                    batch.update(
                        ref,
                        {
                            status: "void"
                        }
                    );
                }
            }

            await batch.commit();

            return {
                ok: true,
                stage: "semis",
                seeded: semiTeams
            };
        }


        /* ------------------------------------------------
           SPORTS WITHOUT SEMIS
           ------------------------------------------------ */

        const finalTeams =
            getFinalTeams(standings);

        if (!finalTeams) {
            return {
                ok: false,
                error:
                    "Not enough teams for final"
            };
        }

        revealMatch(
            batch,
            config.finals[0],
            finalTeams[0],
            finalTeams[1]
        );

        await batch.commit();

        return {
            ok: true,
            stage: "final",
            seeded: finalTeams
        };
    });