const functions = require("firebase-functions");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/**
 * Shift later matches on the same venue whenever a match actually starts.
 * Trigger: /matches/{id} status: "scheduled" → "live"
 */
exports.propagateDelay = functions.firestore
    .document("matches/{matchId}")
    .onUpdate(async (change, context) => {
        const before = change.before.data();
        const after = change.after.data();

        // we only care about the moment it flips to live
        if (before.status === "scheduled" && after.status === "live") {
            const delay =
                after.actual_start.toMillis() - after.scheduled_at.toMillis();

            if (delay <= 0) return null; // started on time or early

            const cutoff = after.scheduled_at;
            const venue = after.venue;
            const eventId = after.event_id;

            // query all later matches on the same court & event
            const q = db
                .collection("matches")
                .where("event_id", "==", eventId)
                .where("venue", "==", venue)
                .where("scheduled_at", ">", cutoff);

            const snap = await q.get();
            const batch = db.batch();

            snap.forEach((doc) => {
                const newTime = new admin.firestore.Timestamp(
                    doc.data().scheduled_at.toDate().getTime() / 1000 +
                        delay / 1000,
                    0
                );
                batch.update(doc.ref, { scheduled_at: newTime });
            });

            console.log(
                `⏩ shifted ${snap.size} matches on ${venue} by ${
                    delay / 60000
                } min`
            );
            return batch.commit();
        }
        return null;
    });
