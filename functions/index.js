/* ================================================================
   SPORTS FIESTA CLOUD FUNCTIONS
   ================================================================

   Main responsibilities:

   1. propagateDelay
      Shift later matches when a match starts late.

   2. revealEliminations
      Wait until ALL qualifiers are finished before revealing
      semi-finals / finals.

   3. advanceEliminations
      Wait until ALL semi-finals are finished before revealing
      bronze + finals.

   4. autoFillAwards
      Fill awards when bronze/final results are completed.

   5. publishAwards
      Publish awards only when champion, runner-up and bronze
      positions are all known.

   Basketball logic is retained separately because its bracket
   structure is different from the other sports.
================================================================ */

const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;


/* ================================================================
   EVENT CONFIGURATION
   ================================================================ */

const EVENT_FORMATS = {

    /* ---------------- BASKETBALL ---------------- */

    basketball3v3: {
        type: "two_groups",
        qualifierPools: ["A", "B"],

        qualifiersNeeded: 2,

        semiMatches: [
            "B-SF1",
            "B-SF2"
        ],

        bronzeMatches: [
            "B-B1"
        ],

        finalMatches: [
            "B-F1"
        ],

        /* Placeholder competitor IDs */
        placeholders: {
            semis: [
                "BW1",
                "BW2",
                "BW3",
                "BW4"
            ],
            bronze: [
                "BSF1L",
                "BSF2L"
            ],
            finals: [
                "BSF1W",
                "BSF2W"
            ]
        }
    },


    /* ---------------- BADMINTON MEN'S SINGLES ---------------- */

    badminton_singles_male: {
        type: "two_groups",
        qualifierPools: ["A", "B"],

        qualifiersNeeded: 2,

        semiMatches: [
            "SM-SF1",
            "SM-SF2"
        ],

        bronzeMatches: [
            "SM-B1"
        ],

        finalMatches: [
            "SM-F1-1",
            "SM-F1-2",
            "SM-F1-3"
        ],

        placeholders: {
            semis: [
                "SMSF1",
                "SMSF2",
                "SMSF3",
                "SMSF4"
            ],
            bronze: [
                "SMB1",
                "SMB2"
            ],
            finals: [
                "SMF1",
                "SMF2"
            ]
        }
    },


    /* ---------------- BADMINTON WOMEN'S SINGLES ---------------- */

    badminton_singles_female: {
        type: "one_group",
        qualifierPools: ["A"],

        qualifiersNeeded: 2,

        semiMatches: [],

        bronzeMatches: [],

        finalMatches: [
            "SF-F1-1",
            "SF-F1-2",
            "SF-F1-3"
        ],

        placeholders: {
            semis: [],
            bronze: [],
            finals: [
                "SFF1",
                "SFF2"
            ]
        }
    },


    /* ---------------- BADMINTON MEN'S DOUBLES ---------------- */

    badminton_doubles_male: {
        type: "two_groups",
        qualifierPools: ["A", "B"],

        qualifiersNeeded: 2,

        semiMatches: [
            "DM-SF1",
            "DM-SF2"
        ],

        bronzeMatches: [
            "DM-B1"
        ],

        finalMatches: [
            "DM-F1-1",
            "DM-F1-2",
            "DM-F1-3"
        ],

        placeholders: {
            semis: [
                "DMSF1",
                "DMSF2",
                "DMSF3",
                "DMSF4"
            ],
            bronze: [
                "DMB1",
                "DMB2"
            ],
            finals: [
                "DMF1",
                "DMF2"
            ]
        }
    },


    /* ---------------- BADMINTON WOMEN'S DOUBLES ---------------- */

    badminton_doubles_female: {
        type: "one_group",
        qualifierPools: ["A"],

        qualifiersNeeded: 2,

        semiMatches: [],

        bronzeMatches: [],

        finalMatches: [
            "DF-F1-1",
            "DF-F1-2",
            "DF-F1-3"
        ],

        placeholders: {
            semis: [],
            bronze: [],
            finals: [
                "DFF1",
                "DFF2"
            ]
        }
    },


    /* ---------------- FRISBEE ---------------- */

    frisbee5v5: {
        type: "one_group",
        qualifierPools: ["A"],

        qualifiersNeeded: 4,

        bronzeMatches: [
            "F-B1"
        ],

        finalMatches: [
            "F-F1"
        ],

        placeholders: {
            bronze: [
                "FB1",
                "FB2"
            ],
            finals: [
                "FF1",
                "FF2"
            ]
        }
    },


    /* ---------------- VOLLEYBALL ---------------- */

    volleyball: {
        type: "two_groups",
        qualifierPools: ["A", "B"],

        qualifiersNeeded: 2,

        semiMatches: [
            "V-SF1",
            "V-SF2"
        ],

        bronzeMatches: [
            "V-B1"
        ],

        finalMatches: [
            "V-F1"
        ],

        placeholders: {
            semis: [
                "VSF1",
                "VSF2",
                "VSF3",
                "VSF4"
            ],
            bronze: [
                "VBF1",
                "VBF2"
            ],
            finals: [
                "VF1",
                "VF2"
            ]
        }
    }
};


/* ================================================================
   HELPER: safely get competitor ID
   ================================================================ */

function getCompetitorId(match) {
    return match?.id || null;
}


/* ================================================================
   HELPER: determine if a competitor is a placeholder
   ================================================================ */

function isPlaceholder(id) {

    if (!id) return true;

    return (
        /* Basketball */
        /^BW[1-8]$/.test(id) ||
        /^BSF[12][WL]$/.test(id) ||

        /* Badminton men's singles */
        /^SMSF[1-4]$/.test(id) ||
        /^SMB[12]$/.test(id) ||
        /^SMF[12]$/.test(id) ||

        /* Badminton women's singles */
        /^SFF[12]$/.test(id) ||

        /* Badminton men's doubles */
        /^DMSF[1-4]$/.test(id) ||
        /^DMB[12]$/.test(id) ||
        /^DMF[12]$/.test(id) ||

        /* Badminton women's doubles */
        /^DFF[12]$/.test(id) ||

        /* Frisbee */
        /^FSF[1-4]$/.test(id) ||
        /^FB[12]$/.test(id) ||
        /^FF[12]$/.test(id) ||

        /* Volleyball */
        /^VSF[1-4]$/.test(id) ||
        /^VBF[12]$/.test(id) ||
        /^VF[12]$/.test(id)
    );
}


/* ================================================================
   HELPER: set a match to hidden
   ================================================================ */

async function hideMatches(matchIds) {

    const batch = db.batch();

    for (const id of matchIds) {
        const ref = db.doc(`matches/${id}`);
        const snap = await ref.get();

        if (!snap.exists) {
            console.warn(`⚠️ Missing match: ${id}`);
            continue;
        }

        batch.update(ref, {
            status: "hidden"
        });
    }

    await batch.commit();
}


/* ================================================================
   HELPER: get all qualifiers for an event
   ================================================================ */

async function getQualifiers(eventId) {

    return db
        .collection("matches")
        .where("event_id", "==", eventId)
        .where("match_type", "==", "qualifier")
        .get();
}


/* ================================================================
   HELPER: calculate standings
   ================================================================ */

function calculateStandings(qualsSnap) {

    const pools = {};

    for (const doc of qualsSnap.docs) {

        const d = doc.data();

        if (
            !d.competitor_a?.id ||
            !d.competitor_b?.id ||
            typeof d.score_a !== "number" ||
            typeof d.score_b !== "number"
        ) {
            continue;
        }

        const pool = d.pool || "A";

        if (!pools[pool]) {
            pools[pool] = {};
        }

        const a = d.competitor_a.id;
        const b = d.competitor_b.id;

        const sa = d.score_a;
        const sb = d.score_b;

        const update = (id, win, diff) => {

            if (!pools[pool][id]) {
                pools[pool][id] = {
                    wins: 0,
                    diff: 0
                };
            }

            pools[pool][id].wins += win;
            pools[pool][id].diff += diff;
        };

        if (sa > sb) {

            update(a, 1, sa - sb);
            update(b, 0, sb - sa);

        } else if (sb > sa) {

            update(b, 1, sb - sa);
            update(a, 0, sa - sb);

        } else {

            update(a, 0, 0);
            update(b, 0, 0);
        }
    }

    return pools;
}


/* ================================================================
   HELPER: rank a pool
   ================================================================ */

function rankPool(pool) {

    return Object.entries(pool || {})
        .sort(
            ([, a], [, b]) =>
                b.wins - a.wins ||
                b.diff - a.diff
        )
        .map(([id]) => id);
}


/* ================================================================
   HELPER: seed competitors into a match
   ================================================================ */

function seedMatch(batch, matchId, competitorA, competitorB) {

    batch.update(
        db.doc(`matches/${matchId}`),
        {
            competitor_a: {
                id: competitorA
            },

            competitor_b: {
                id: competitorB
            },

            score_a: null,
            score_b: null,

            status: "scheduled"
        }
    );
}

/* ================================================================
   HELPER: seed a hidden match

   Used for later badminton final games. The competitors are already
   known, but the match must not be visible until progression allows it.
================================================================ */

function seedHiddenMatch(batch, matchId, competitorA, competitorB) {

    batch.update(
        db.doc(`matches/${matchId}`),
        {
            competitor_a: {
                id: competitorA
            },

            competitor_b: {
                id: competitorB
            },

            score_a: null,
            score_b: null,
        }
    );
}


/* ================================================================
   1. PROPAGATE DELAY
   ================================================================ */

exports.propagateDelay = functions.firestore
    .document("matches/{matchId}")
    .onUpdate(async (chg, _) => {

        const before = chg.before.data();
        const after = chg.after.data();

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

        const later = await db
            .collection("matches")
            .where("event_id", "==", after.event_id)
            .where("venue", "==", after.venue)
            .where(
                "scheduled_at",
                ">",
                after.scheduled_at
            )
            .get();

        const batch = db.batch();

        later.forEach(doc => {

            const oldTime =
                doc.data().scheduled_at.toMillis();

            const newTime =
                new admin.firestore.Timestamp(
                    Math.floor(
                        (oldTime + delay) / 1000
                    ),
                    0
                );

            batch.update(
                doc.ref,
                {
                    scheduled_at: newTime
                }
            );
        });

        console.log(
            `⏩ Shifted ${later.size} matches by ${
                delay / 60000
            } minutes`
        );

        return batch.commit();
    });


/* ================================================================
   2. REVEAL ELIMINATION STAGE
   ================================================================

   IMPORTANT:

   This function ONLY reveals the semi-finals / final.

   It NEVER creates bronze/final after an individual semi.

   For sports with semis:
       ALL qualifiers → ALL semis become scheduled.

   For sports without semis:
       ALL qualifiers → final becomes scheduled.
================================================================ */

exports.revealEliminations = functions.firestore
    .document("matches/{matchId}")
    .onUpdate(async (change, context) => {

        const before = change.before.data();
        const after = change.after.data();

        if (
            after.status !== "final" ||
            before.status === "final"
        ) {
            return null;
        }

        if (
            after.match_type !== "qualifier"
        ) {
            return null;
        }

        const eventId = after.event_id;
        const config = EVENT_FORMATS[eventId];

        if (!config) {
            return null;
        }

        console.log(
            `🏁 Qualifier completed for ${eventId}`
        );


        /* --------------------------------------------------------
           Check ALL qualifiers
        -------------------------------------------------------- */

        const qualsSnap =
            await getQualifiers(eventId);

        const unfinished =
            qualsSnap.docs.filter(
                d => d.data().status !== "final"
            );

        if (unfinished.length > 0) {

            console.log(
                `⏳ ${eventId}: ${unfinished.length} qualifiers remain`
            );

            /*
             * Explicitly keep elimination matches hidden.
             * This prevents them appearing prematurely even if
             * they were initially created as scheduled.
             */

            await hideMatches([
                ...config.semiMatches,
                ...config.bronzeMatches,
                ...config.finalMatches
            ]);

            return null;
        }


        /* --------------------------------------------------------
           Calculate standings
        -------------------------------------------------------- */

        const pools =
            calculateStandings(qualsSnap);


        /* ========================================================
           NO SEMIS
           ======================================================== */

        if (config.semiMatches.length === 0) {

            const pool =
                rankPool(
                    pools[config.qualifierPools[0]]
                );

            if (pool.length < 2) {

                console.error(
                    `❌ ${eventId}: not enough teams`
                );

                return null;
            }

            const first = pool[0];
            const second = pool[1];

            console.log(
                `🏆 ${eventId}: direct final ${first} vs ${second}`
            );

            const batch = db.batch();

            if (eventId.startsWith("badminton")) {

                /*
                * Seed ALL three games with the same competitors.
                *
                * Only Game 1 is visible initially.
                * Games 2 and 3 remain hidden until the best-of-3
                * progression logic reveals them.
                */

                seedMatch(
                    batch,
                    config.finalMatches[0],
                    first,
                    second
                );

                for (const matchId of config.finalMatches.slice(1)) {

                    seedHiddenMatch(
                        batch,
                        matchId,
                        first,
                        second
                    );
                }

            } else {

                seedMatch(
                    batch,
                    config.finalMatches[0],
                    first,
                    second
                );
            }

            await batch.commit();

            return null;
        }


        /* ========================================================
           SEMI-FINAL FORMAT
           ======================================================== */

        let semiSeeds;


        /* --------------------------------------------------------
           TWO GROUPS

           A1 vs B2
           B1 vs A2
        -------------------------------------------------------- */

        if (config.type === "two_groups") {

            const A =
                rankPool(pools["A"]);

            const B =
                rankPool(pools["B"]);

            if (
                A.length < 2 ||
                B.length < 2
            ) {

                console.error(
                    `❌ ${eventId}: insufficient pool standings`
                );

                return null;
            }

            semiSeeds = [
                [A[0], B[1]],
                [B[0], A[1]]
            ];
        }


        /* --------------------------------------------------------
           ONE GROUP

           1st vs 4th
           2nd vs 3rd
        -------------------------------------------------------- */

        else if (config.type === "one_group") {

            const ranked =
                rankPool(
                    pools[
                        config.qualifierPools[0]
                    ]
                );

            if (ranked.length < 4) {

                console.error(
                    `❌ ${eventId}: need at least 4 teams`
                );

                return null;
            }

            semiSeeds = [
                [ranked[0], ranked[3]],
                [ranked[1], ranked[2]]
            ];
        }


        /* --------------------------------------------------------
           Reveal ALL semis simultaneously
        -------------------------------------------------------- */

        const batch = db.batch();

        for (
            let i = 0;
            i < config.semiMatches.length;
            i++
        ) {

            const matchId =
                config.semiMatches[i];

            const [a, b] =
                semiSeeds[i];

            seedMatch(
                batch,
                matchId,
                a,
                b
            );
        }


        /* --------------------------------------------------------
           Bronze + final MUST REMAIN HIDDEN
        -------------------------------------------------------- */

        for (
            const matchId of [
                ...config.bronzeMatches,
                ...config.finalMatches
            ]
        ) {

            const ref =
                db.doc(`matches/${matchId}`);

            batch.update(
                ref,
                {
                    status: "hidden"
                }
            );
        }

        await batch.commit();

        console.log(
            `✅ ${eventId}: all semi-finals revealed`
        );

        return null;
    });


/* ================================================================
   3. ADVANCE AFTER ALL SEMI-FINALS
   ================================================================

   THIS IS THE IMPORTANT FIX.

   We do NOT advance when one semi finishes.

   We first query ALL semi matches.

   If even ONE is not final:
       do absolutely nothing.

   Only when EVERY semi is final:
       determine winners/losers
       populate bronze
       populate final
================================================================ */

exports.advanceEliminations = functions.firestore
    .document("matches/{matchId}")
    .onUpdate(async (change, context) => {

        const before = change.before.data();
        const after = change.after.data();

        if (
            after.status !== "final" ||
            before.status === "final"
        ) {
            return null;
        }

        if (
            after.match_type !== "semi"
        ) {
            return null;
        }

        const eventId = after.event_id;
        const config = EVENT_FORMATS[eventId];

        if (!config) {
            return null;
        }

        if (
            !config.semiMatches.includes(
                context.params.matchId
            )
        ) {
            return null;
        }

        console.log(
            `🥇 Semi completed for ${eventId}: ${
                context.params.matchId
            }`
        );


        /* --------------------------------------------------------
           GET EVERY SEMI
        -------------------------------------------------------- */

        const semiRefs =
            config.semiMatches.map(
                id => db.doc(`matches/${id}`)
            );

        const semiDocs =
            await db.getAll(...semiRefs);


        /* --------------------------------------------------------
           CRITICAL CHECK:
           ALL semis MUST be final.
        -------------------------------------------------------- */

        const unfinished =
            semiDocs.filter(
                doc =>
                    !doc.exists ||
                    doc.data().status !== "final"
            );

        if (unfinished.length > 0) {

            console.log(
                `⏳ ${eventId}: ${
                    unfinished.length
                } semi-final(s) still unfinished.`
            );

            /*
             * Do NOT touch bronze/final.
             */
            return null;
        }


        console.log(
            `✅ ${eventId}: ALL semi-finals completed`
        );


        /* --------------------------------------------------------
           Determine winners and losers
        -------------------------------------------------------- */

        const results = [];

        for (const doc of semiDocs) {

            const d = doc.data();

            if (
                !d.competitor_a?.id ||
                !d.competitor_b?.id
            ) {
                console.error(
                    `❌ ${doc.id}: missing competitors`
                );

                return null;
            }

            if (
                typeof d.score_a !== "number" ||
                typeof d.score_b !== "number"
            ) {
                console.error(
                    `❌ ${doc.id}: invalid scores`
                );

                return null;
            }

            if (d.score_a === d.score_b) {

                console.error(
                    `❌ ${doc.id}: tied semi-final`
                );

                return null;
            }

            const a =
                d.competitor_a.id;

            const b =
                d.competitor_b.id;

            const winner =
                d.score_a > d.score_b
                    ? a
                    : b;

            const loser =
                winner === a
                    ? b
                    : a;

            results.push({
                winner,
                loser
            });
        }


        if (results.length !== 2) {

            console.error(
                `❌ ${eventId}: expected exactly 2 semi-final results`
            );

            return null;
        }


        const finalA =
            results[0].winner;

        const finalB =
            results[1].winner;

        const bronzeA =
            results[0].loser;

        const bronzeB =
            results[1].loser;


        /* --------------------------------------------------------
           Populate bronze + final
        -------------------------------------------------------- */

        const batch = db.batch();


        if (eventId.startsWith("badminton")) {

            /*
            * Seed ALL three games with the same finalists.
            *
            * Game 1 is revealed immediately.
            * Games 2 and 3 receive the same competitors but remain hidden.
            * advanceBadmintonFinal controls when they become scheduled.
            */

            seedMatch(
                batch,
                config.finalMatches[0],
                finalA,
                finalB
            );

            for (const matchId of config.finalMatches.slice(1)) {

                seedHiddenMatch(
                    batch,
                    matchId,
                    finalA,
                    finalB
                );
            }

        } else {

            for (const matchId of config.finalMatches) {

                seedMatch(
                    batch,
                    matchId,
                    finalA,
                    finalB
                );
            }
        } 
         


        for (
            const matchId of config.bronzeMatches
        ) {

            seedMatch(
                batch,
                matchId,
                bronzeA,
                bronzeB
            );
        }


        await batch.commit();


        console.log(
            `🏆 ${eventId}: finals and bronze now revealed`,
            {
                finalA,
                finalB,
                bronzeA,
                bronzeB
            }
        );

        return null;
    });


/* ================================================================
   4. BASKETBALL QUALIFIER → SEMI
   ================================================================

   Retained separately.

   A1 vs B2
   B1 vs A2

   It only triggers once ALL basketball qualifiers are final.
================================================================ */

exports.revealBasketballElims =
    functions.firestore
        .document("matches/{matchId}")
        .onUpdate(async (change, context) => {

            const before =
                change.before.data();

            const after =
                change.after.data();

            if (
                after.event_id !==
                "basketball3v3"
            ) {
                return null;
            }

            if (
                after.match_type !==
                "qualifier"
            ) {
                return null;
            }

            if (
                after.status !== "final" ||
                before.status === "final"
            ) {
                return null;
            }

            const qualsSnap =
                await getQualifiers(
                    "basketball3v3"
                );

            const unfinished =
                qualsSnap.docs.filter(
                    d =>
                        d.data().status !==
                        "final"
                );

            if (unfinished.length) {

                console.log(
                    `🏀 ${unfinished.length} BB qualifiers remaining`
                );

                return null;
            }


            const pools =
                calculateStandings(
                    qualsSnap
                );

            const A =
                rankPool(pools.A);

            const B =
                rankPool(pools.B);

            if (
                A.length < 2 ||
                B.length < 2
            ) {

                console.error(
                    "❌ Basketball pools incomplete"
                );

                return null;
            }


            const A1 = A[0];
            const A2 = A[1];
            const B1 = B[0];
            const B2 = B[1];


            const batch =
                db.batch();


            seedMatch(
                batch,
                "B-SF1",
                A1,
                B2
            );

            seedMatch(
                batch,
                "B-SF2",
                B1,
                A2
            );


            /*
             * CRITICAL:
             * Basketball bronze/final remain hidden until
             * BOTH semis finish.
             */

            batch.update(
                db.doc("matches/B-B1"),
                {
                    status: "hidden"
                }
            );

            batch.update(
                db.doc("matches/B-F1"),
                {
                    status: "hidden"
                }
            );


            await batch.commit();

            console.log(
                "🏀 Basketball semi-finals revealed"
            );

            return null;
        });


/* ================================================================
   BADMINTON BEST-OF-3 FINAL PROGRESSION
================================================================ */

exports.advanceBadmintonFinal = functions.firestore
    .document("matches/{matchId}")
    .onUpdate(async (change, context) => {

        const before = change.before.data();
        const after = change.after.data();

        // Only run when a match has just been completed.
        if (
            after.status !== "final" ||
            before.status === "final"
        ) {
            return null;
        }

        const eventId = after.event_id;

        // Only badminton events.
        if (!eventId?.startsWith("badminton")) {
            return null;
        }

        const config = EVENT_FORMATS[eventId];

        if (!config?.finalMatches?.includes(context.params.matchId)) {
            return null;
        }

        const finalMatches = config.finalMatches;

        const currentIndex =
            finalMatches.indexOf(context.params.matchId);

        // Must have valid competitors and scores.
        if (
            !after.competitor_a?.id ||
            !after.competitor_b?.id ||
            typeof after.score_a !== "number" ||
            typeof after.score_b !== "number" ||
            after.score_a === after.score_b
        ) {
            return null;
        }

        const playerA = after.competitor_a.id;
        const playerB = after.competitor_b.id;

        const winner =
            after.score_a > after.score_b
                ? playerA
                : playerB;

        /* --------------------------------------------------------
           GAME 1 FINISHED
        -------------------------------------------------------- */

        if (currentIndex === 0) {

            // Reveal Game 2 with the same competitors.
            const game2Ref =
                db.doc(`matches/${finalMatches[1]}`);

            await game2Ref.set(
                {
                    competitor_a: { id: playerA },
                    competitor_b: { id: playerB },
                    status: "scheduled"
                },
                { merge: true }
            );

            return null;
        }

        /* --------------------------------------------------------
           GAME 2 FINISHED
        -------------------------------------------------------- */

        if (currentIndex === 1) {

            const game1Snap =
                await db.doc(
                    `matches/${finalMatches[0]}`
                ).get();

            if (!game1Snap.exists) {
                return null;
            }

            const game1 = game1Snap.data();

            if (
                typeof game1.score_a !== "number" ||
                typeof game1.score_b !== "number"
            ) {
                return null;
            }

            const game1Winner =
                game1.score_a > game1.score_b
                    ? game1.competitor_a.id
                    : game1.competitor_b.id;

            // Same player won Games 1 and 2.
            // Best-of-3 is over; Game 3 stays hidden.
            if (game1Winner === winner) {

                await db.doc(
                    `matches/${finalMatches[2]}`
                ).update({
                    status: "hidden"
                });

                console.log(
                    `🏆 ${eventId}: ${winner} wins 2-0`
                );

                return null;
            }

            // One win each → reveal Game 3.
            await db.doc(
                `matches/${finalMatches[2]}`
            ).set(
                {
                    competitor_a: { id: playerA },
                    competitor_b: { id: playerB },
                    status: "scheduled"
                },
                { merge: true }
            );

            console.log(
                `🏸 ${eventId}: final tied 1-1, revealing Game 3`
            );

            return null;
        }

        // Game 3 finished. Series is complete.
        if (currentIndex === 2) {

            console.log(
                `🏆 ${eventId}: best-of-3 final complete`
            );

            return null;
        }

        return null;
    });

/* ================================================================
   5. BASKETBALL SEMIS → FINAL / BRONZE
   ================================================================ */

exports.advanceBasketballElims =
    functions.firestore
        .document("matches/{matchId}")
        .onUpdate(async (change, context) => {

            const before =
                change.before.data();

            const after =
                change.after.data();

            if (
                after.event_id !==
                "basketball3v3"
            ) {
                return null;
            }

            if (
                after.match_type !==
                "semi"
            ) {
                return null;
            }

            if (
                after.status !== "final" ||
                before.status === "final"
            ) {
                return null;
            }


            const id =
                context.params.matchId;

            if (
                !["B-SF1", "B-SF2"]
                    .includes(id)
            ) {
                return null;
            }


            /* ----------------------------------------------------
               GET BOTH SEMIS
            ---------------------------------------------------- */

            const [sf1, sf2] =
                await Promise.all([
                    db.doc("matches/B-SF1").get(),
                    db.doc("matches/B-SF2").get()
                ]);


            /* ----------------------------------------------------
               DO NOT ADVANCE UNTIL BOTH ARE FINAL
            ---------------------------------------------------- */

            if (
                !sf1.exists ||
                !sf2.exists ||
                sf1.data().status !== "final" ||
                sf2.data().status !== "final"
            ) {

                console.log(
                    "🏀 Waiting for both basketball semis"
                );

                return null;
            }


            const getResult = doc => {

                const d =
                    doc.data();

                const a =
                    d.competitor_a.id;

                const b =
                    d.competitor_b.id;

                if (
                    typeof d.score_a !==
                        "number" ||
                    typeof d.score_b !==
                        "number"
                ) {
                    return null;
                }

                const winner =
                    d.score_a >
                    d.score_b
                        ? a
                        : b;

                const loser =
                    winner === a
                        ? b
                        : a;

                return {
                    winner,
                    loser
                };
            };


            const r1 =
                getResult(sf1);

            const r2 =
                getResult(sf2);

            if (!r1 || !r2) {
                return null;
            }


            const batch =
                db.batch();


            batch.update(
                db.doc("matches/B-F1"),
                {
                    competitor_a: {
                        id: r1.winner
                    },

                    competitor_b: {
                        id: r2.winner
                    },

                    score_a: null,
                    score_b: null,
                    status: "scheduled"
                }
            );


            batch.update(
                db.doc("matches/B-B1"),
                {
                    competitor_a: {
                        id: r1.loser
                    },

                    competitor_b: {
                        id: r2.loser
                    },

                    score_a: null,
                    score_b: null,
                    status: "scheduled"
                }
            );


            await batch.commit();

            console.log(
                "🏀 Both basketball semis complete → final + bronze"
            );

            return null;
        });


/* ================================================================
   6. AWARDS
   ================================================================ */

async function fillAward(
    eventId,
    type,
    winnerId,
    loserId = null
) {

    const awardData = {};

    if (type === "final") {

        awardData.champion = {
            id: winnerId
        };

        awardData.first_runner_up = {
            id: loserId
        };

    } else if (type === "bronze") {

        awardData.second_runner_up = {
            id: winnerId
        };
    }


    await db.doc(
        `awards/${eventId}`
    ).set(
        {
            ...awardData,

            updated_at:
                FieldValue.serverTimestamp(),

            published: false
        },
        {
            merge: true
        }
    );
}


/* ---------------------------------------------------------------
   Award trigger

   Only final / bronze matches can affect awards.

   This means semifinals NEVER publish awards.
---------------------------------------------------------------- */

exports.autoFillAwards =
    functions.firestore
        .document("matches/{matchId}")
        .onUpdate(async (change, context) => {

            const before =
                change.before.data();

            const after =
                change.after.data();

            if (
                after.status !== "final" ||
                before.status === "final"
            ) {
                return null;
            }

            const eventId =
                after.event_id;

            const config =
                EVENT_FORMATS[eventId];

            if (!config) {
                return null;
            }


            const matchId =
                context.params.matchId;


            const isFinal =
                config.finalMatches
                    .includes(matchId);

            const isBronze =
                config.bronzeMatches
                    .includes(matchId);


            if (!isFinal && !isBronze) {
                return null;
            }


            const a =
                after.competitor_a?.id;

            const b =
                after.competitor_b?.id;


            if (
                !a ||
                !b ||
                typeof after.score_a !==
                    "number" ||
                typeof after.score_b !==
                    "number"
            ) {

                console.error(
                    `❌ Invalid result for ${matchId}`
                );

                return null;
            }


            if (
                after.score_a ===
                after.score_b
            ) {

                console.error(
                    `❌ Tie in ${matchId}`
                );

                return null;
            }


            const winner =
                after.score_a >
                after.score_b
                    ? a
                    : b;

            const loser =
                winner === a
                    ? b
                    : a;


            if (isFinal) {
                // Female badminton has no bronze match,
                // but 3rd place is still awarded to the 3rd-ranked
                // qualifier.
                if (
                    eventId === "badminton_singles_female" ||
                    eventId === "badminton_doubles_female"
                ) {
                    const qualsSnap = await getQualifiers(eventId);
                    const pools = calculateStandings(qualsSnap);
                    const ranked = rankPool(
                        pools[config.qualifierPools[0]]
                    );

                    if (ranked.length < 3) {
                        console.error(
                            `❌ ${eventId}: cannot determine 3rd place`
                        );
                        return null;
                    }

                    await fillAward(
                        eventId,
                        "final",
                        winner,
                        loser
                    );

                    await fillAward(
                        eventId,
                        "bronze",
                        ranked[2]
                    );

                    console.log(
                        `🏆 ${eventId}: champion=${winner}, runner-up=${loser}, 3rd=${ranked[2]}`
                    );
                } else {
                    await fillAward(
                        eventId,
                        "final",
                        winner,
                        loser
                    );

                    console.log(
                        `🏆 ${eventId}: champion=${winner}, runner-up=${loser}`
                    );
                }
            } else {

                await fillAward(
                    eventId,
                    "bronze",
                    winner
                );

                console.log(
                    `🥉 ${eventId}: bronze=${winner}`
                );
            }


            return null;
        });


/* ================================================================
   7. PUBLISH AWARDS
   ================================================================ */

exports.publishAwards =
    functions.firestore
        .document("awards/{eventId}")
        .onWrite(async (change, context) => {

            if (!change.after.exists) {
                return null;
            }

            const data =
                change.after.data();

            if (data.published) {
                return null;
            }


            const ready =
                !!data.champion &&
                !!data.first_runner_up &&
                !!data.second_runner_up;


            if (!ready) {
                return null;
            }


            await change.after.ref.update({

                published: true,

                published_at:
                    FieldValue.serverTimestamp()
            });


            console.log(
                `🏅 Awards published for ${context.params.eventId}`
            );

            return null;
        });


/* ================================================================
   8. MANUAL RESEED
   ================================================================

   Useful if the qualifiers were already completed before the
   new Cloud Function was deployed.
================================================================ */

exports.reseedElims =
    functions.https.onCall(
        async (data, context) => {

            const sport =
                data?.sport;

            if (
                !sport ||
                !EVENT_FORMATS[sport]
            ) {

                return {
                    ok: false,
                    error:
                        "Invalid sport"
                };
            }


            const config =
                EVENT_FORMATS[sport];


            const qualsSnap =
                await getQualifiers(
                    sport
                );


            if (
                qualsSnap.empty
            ) {

                return {
                    ok: false,
                    error:
                        "No qualifiers found"
                };
            }


            const unfinished =
                qualsSnap.docs.filter(
                    d =>
                        d.data().status !==
                        "final"
                );


            if (unfinished.length) {

                return {
                    ok: false,
                    error:
                        `${unfinished.length} qualifiers are not final`
                };
            }


            const pools =
                calculateStandings(
                    qualsSnap
                );


            /* ----------------------------------------------------
               Direct final
            ---------------------------------------------------- */

            if (
                config.semiMatches.length ===
                0
            ) {

                const ranked =
                    rankPool(
                        pools[
                            config
                                .qualifierPools[0]
                        ]
                    );

                if (
                    ranked.length < 2
                ) {

                    return {
                        ok: false,
                        error:
                            "Not enough teams"
                    };
                }


                const batch =
                    db.batch();

                if (sport.startsWith("badminton")) {

                    // Game 1 is visible.
                    seedMatch(
                        batch,
                        config.finalMatches[0],
                        ranked[0],
                        ranked[1]
                    );

                    /*
                    * Games 2 and 3 have the same competitors,
                    * but remain hidden until required.
                    */
                    for (const matchId of config.finalMatches.slice(1)) {

                        seedHiddenMatch(
                            batch,
                            matchId,
                            ranked[0],
                            ranked[1]
                        );
                    }

                } else {

                    seedMatch(
                        batch,
                        config.finalMatches[0],
                        ranked[0],
                        ranked[1]
                    );
                }

                await batch.commit();


                return {
                    ok: true,

                    stage:
                        "final",

                    seeded: {
                        first: ranked[0],
                        second: ranked[1]
                    }
                };
            }


            /* ----------------------------------------------------
               Two groups
            ---------------------------------------------------- */

            let semiSeeds;

            if (
                config.type ===
                "two_groups"
            ) {

                const A =
                    rankPool(
                        pools.A
                    );

                const B =
                    rankPool(
                        pools.B
                    );

                if (
                    A.length < 2 ||
                    B.length < 2
                ) {

                    return {
                        ok: false,
                        error:
                            "Pool standings incomplete"
                    };
                }


                semiSeeds = [
                    [A[0], B[1]],
                    [B[0], A[1]]
                ];
            }


            /* ----------------------------------------------------
               One group
            ---------------------------------------------------- */

            else {

                const ranked =
                    rankPool(
                        pools[
                            config
                                .qualifierPools[0]
                        ]
                    );

                if (
                    ranked.length < 4
                ) {

                    return {
                        ok: false,
                        error:
                            "Need at least 4 teams"
                    };
                }


                semiSeeds = [
                    [ranked[0], ranked[3]],
                    [ranked[1], ranked[2]]
                ];
            }


            const batch =
                db.batch();


            for (
                let i = 0;
                i < config.semiMatches.length;
                i++
            ) {

                seedMatch(
                    batch,
                    config.semiMatches[i],
                    semiSeeds[i][0],
                    semiSeeds[i][1]
                );
            }


            /* Keep bronze/final hidden */

            for (
                const id of [
                    ...config.bronzeMatches,
                    ...config.finalMatches
                ]
            ) {

                batch.update(
                    db.doc(`matches/${id}`),
                    {
                        status: "hidden"
                    }
                );
            }


            await batch.commit();


            return {
                ok: true,

                stage: "semis",

                seeds: semiSeeds
            };
        }
    );