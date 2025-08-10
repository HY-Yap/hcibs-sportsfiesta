/*  Awards page — show per-event awards with live updates + roster
    ------------------------------------------------------------- */

import {
    collection,
    doc,
    getDocs,
    getDoc,
    onSnapshot,
    query,
    where,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const { db } = window.firebase; // provided by firebase-init.js
const wrap = document.getElementById("awardsContainer");
const tmpl = document.getElementById("awardTemplate");

/* -------- helpers ------------------------------------------------------ */

const pretty = (id) =>
    id
        .replace(/_/g, " ")
        .replace(/\b([a-z])/g, (m) => m.toUpperCase())
        .replace("Singles", "(Singles)")
        .replace("Doubles", "(Doubles)")
        .replace("5v5", " 5v5")
        .replace("3v3", " 3v3");

const teamCache = new Map();

// Helper function for event-scoped team name resolution
async function resolveTeamName(eventId, competitorId) {
    if (!competitorId) return competitorId;

    const cacheKey = `${eventId}__${competitorId}`;
    if (teamCache.has(cacheKey)) return teamCache.get(cacheKey);

    try {
        // Try namespaced first (new format)
        const namespacedId = `${eventId}__${competitorId}`;
        let snap = await getDoc(doc(db, "teams", namespacedId));

        // Fall back to legacy format
        if (!snap.exists()) {
            snap = await getDoc(doc(db, "teams", competitorId));
        }

        const data = snap.exists() ? snap.data() : {};
        const info = {
            name: data.name || competitorId,
            roster: data.member_emails || data.roster || [],
        };

        teamCache.set(cacheKey, info);
        return info;
    } catch (error) {
        console.warn(`Failed to resolve team info for ${competitorId}:`, error);
        const fallback = { name: competitorId, roster: [] };
        teamCache.set(cacheKey, fallback);
        return fallback;
    }
}

// Legacy function for backward compatibility (if needed)
async function teamInfo(tid) {
    if (teamCache.has(tid)) return teamCache.get(tid);
    const snap = await getDoc(doc(db, "teams", tid));
    const info = snap.exists()
        ? {
              name: snap.data().name || tid,
              roster: snap.data().member_emails || snap.data().roster || [],
          }
        : { name: tid, roster: [] };
    teamCache.set(tid, info);
    return info;
}

// Enhanced roster formatting with actual player names
async function formatRoster(roster) {
    if (!roster || roster.length === 0) return "";

    // Look up actual player names from users collection
    const namePromises = roster.map(async (email) => {
        try {
            // Query users collection by email
            const userQuery = query(
                collection(db, "users"),
                where("email", "==", email)
            );
            const snapshot = await getDocs(userQuery);

            if (!snapshot.empty) {
                const userData = snapshot.docs[0].data();
                return userData.full_name || userData.name || email;
            }
        } catch (error) {
            console.warn(`Failed to resolve name for ${email}:`, error);
        }

        // Fallback to email if lookup fails
        return email;
    });

    const resolvedNames = await Promise.all(namePromises);

    return `<i class="fas fa-users text-gray-400 mr-1"></i>${resolvedNames.join(
        " • "
    )}`;
}

/* -------- per-event renderer ------------------------------------------ */

async function renderEvent(eventId, awardData) {
    let sec = document.getElementById(`awards-${eventId}`);

    if (!sec) {
        sec = tmpl.cloneNode(true);
        sec.id = `awards-${eventId}`;
        sec.classList.remove("hidden");
        sec.querySelector("h2").textContent = pretty(eventId);
        wrap.appendChild(sec);
    }

    const note = sec.querySelector(".publishNote");
    const table = sec.querySelector(".tableWrap");
    const tbody = table.querySelector("tbody");

    /* reset */
    tbody.replaceChildren();
    note.classList.remove("hidden");
    table.classList.add("hidden");

    if (!awardData || !awardData.published) {
        note.textContent = "Awards have not been published yet.";
        return;
    }

    /* build rows */
    const slots = [
        ["champion", "Champion"],
        ["first_runner_up", "1st Runner-up"],
        ["second_runner_up", "2nd Runner-up"],
    ];

    for (const [key, label] of slots) {
        if (!awardData[key]) continue;

        const { id } = awardData[key];

        // 🔥 Use event-scoped team resolution
        const { name, roster } = await resolveTeamName(eventId, id);

        // 🔥 Wait for roster names to resolve
        const rosterDisplay = roster.length
            ? `<br><span class="text-xs text-gray-600">${await formatRoster(
                  roster
              )}</span>`
            : "";

        tbody.insertAdjacentHTML(
            "beforeend",
            `<tr class="even:bg-gray-50">
                <td class="px-3 py-2 font-medium text-gray-900">${label}</td>
                <td class="px-3 py-2">
                    <span class="font-semibold text-blue-600">${name}</span>
                    ${rosterDisplay}
                </td>
            </tr>`
        );
    }

    if (tbody.children.length) {
        note.classList.add("hidden");
        table.classList.remove("hidden");
    } else {
        note.textContent = "Awards have not been published yet.";
    }
}

/* -------- initialise sections & live listeners ------------------------ */

const evSnap = await getDocs(collection(db, "events"));
const evIds = evSnap.docs.map((d) => d.id).sort();

/* create placeholder sections */
evIds.forEach((eid) => renderEvent(eid, null));

/* live listeners */
evIds.forEach((eid) =>
    onSnapshot(
        doc(db, "awards", eid),
        (d) => renderEvent(eid, d.exists() ? d.data() : null),
        () => {
            /* normal when awards doc not yet created */
        }
    )
);

console.log("🏅 Awards page — listeners active for", evIds.length, "events");
