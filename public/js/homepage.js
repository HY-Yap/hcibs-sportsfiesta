// js/homepage.js
import {
    collection,
    getDocs,
    query,
    where,
    orderBy,
    limit,
    doc,
    getDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { auth, db } from "./firebase-init.js";

// Helper function to check if a team ID is a placeholder
function isPlaceholder(teamId) {
    if (!teamId) return true;

    // 🔥 Special teams that should be treated as real
    const specialRealTeams = ["IBP"];
    if (specialRealTeams.includes(teamId)) return false;

    // Real team name patterns (your imported teams)
    if (/^BD-Team-\d+$/.test(teamId)) return false; // Badminton Doubles
    if (/^BS-Team-\d+$/.test(teamId)) return false; // Badminton Singles
    if (/^BB-Team-\d+$/.test(teamId)) return false; // Basketball
    if (/^FS-Team-\d+$/.test(teamId)) return false; // Frisbee

    // 🔥 Add more flexible patterns for your actual team names
    if (/^[A-Z]{2,3}-Team-\d+$/.test(teamId)) return false; // Any XX-Team-## format

    // Real team abbreviations (usually 2-4 letters)
    if (/^[A-Z]{2,4}$/.test(teamId)) return false; // IBP, ACDC, etc.

    // 🔥 CONTEXT-AWARE: Pool teams (A1, B2, etc.) - depends on context!
    // These are REAL teams in qualifiers, but PLACEHOLDERS in eliminations
    // For homepage, treat them as REAL since we want to show qualifier matches
    if (/^[A-D][1-4]$/.test(teamId)) return false; // Treat as real teams

    // ===== TRUE PLACEHOLDERS (elimination bracket positions) =====

    // Badminton elimination placeholders
    if (/^(?:S|D)[FB]W\d+$/.test(teamId)) return true; // SFW1, DBW2, SBW1, etc.
    if (/^(?:S|D)[1-4]$/.test(teamId)) return true; // S1, S2, D3, D4 (semi slots)

    // Basketball elimination placeholders
    if (/^BW[1-8]$/.test(teamId)) return true; // BW1, BW2, etc.
    if (/^B(?:QF[1-4]W|SF[12][WL])$/.test(teamId)) return true; // BQF1W, BSF1L, etc.
    if (/^BSF[1-4][LW]$/.test(teamId)) return true; // BSF1L, BSF2W, etc.

    // Frisbee elimination placeholders
    if (/^F(?:R[12]W|SF[12][WL]|CHAMP)$/.test(teamId)) return true; // FR1W, FSF1L, FCHAMP

    // Bracket position placeholders (winners/losers of specific matches)
    if (/^[SD][A-Z]\d+$/.test(teamId)) return true; // SB3, SD4, DA1, etc. (if these are placeholders)
    if (/^B[A-Z]\d+$/.test(teamId)) return true; // Basketball brackets (if these are placeholders)

    // Default: treat as real team if no pattern matches
    return false;
}

// Helper function to check if a match has real teams (not placeholders)
function hasRealTeams(match) {
    return (
        !isPlaceholder(match.competitor_a?.id) &&
        !isPlaceholder(match.competitor_b?.id)
    );
}

// Load homepage data
async function loadHomepageData() {
    try {
        console.log("Loading homepage data...");

        await Promise.all([
            loadTeamCounts(),
            loadRecentResults(),
            loadUpcomingMatches(),
            loadAthleteCount(),
            setupQuickActions(), // Add this line
        ]);

        console.log("Homepage data loaded successfully");
    } catch (error) {
        console.error("Error loading homepage data:", error);
    }
}

async function loadTeamCounts() {
    const events = [
        "badminton_singles",
        "badminton_doubles",
        "basketball3v3",
        "frisbee5v5",
    ];
    // Remove: let totalMatches = 0;

    for (const event of events) {
        try {
            const teamsSnap = await getDocs(
                query(collection(db, "teams"), where("event_id", "==", event))
            );

            const count = teamsSnap.size;
            console.log(`${event}: ${count} teams`);

            // Update UI based on event type
            if (event.includes("badminton")) {
                const badmintonElement =
                    document.getElementById("badminton-teams");
                if (badmintonElement) {
                    const current = parseInt(badmintonElement.textContent) || 0;
                    badmintonElement.textContent = current + count;
                }
            } else if (event === "basketball3v3") {
                const basketballElement =
                    document.getElementById("basketball-teams");
                if (basketballElement) {
                    basketballElement.textContent = count;
                }
            } else if (event === "frisbee5v5") {
                const frisbeeElement = document.getElementById("frisbee-teams");
                if (frisbeeElement) {
                    frisbeeElement.textContent = count;
                }
            }

            // Remove: totalMatches += Math.max(0, (count * (count - 1)) / 2);
        } catch (e) {
            console.warn(`Failed to load teams for ${event}:`, e);
        }
    }

    // 🔥 COUNT ACTUAL MATCHES FROM DATABASE
    try {
        const matchesSnap = await getDocs(collection(db, "matches"));
        const totalMatches = matchesSnap.size;
        console.log(`Found ${totalMatches} total matches in database`);

        const totalMatchesElement = document.getElementById("total-matches");
        if (totalMatchesElement) {
            totalMatchesElement.textContent = totalMatches;
        }
    } catch (e) {
        console.warn("Failed to load total matches count:", e);
        const totalMatchesElement = document.getElementById("total-matches");
        if (totalMatchesElement) {
            totalMatchesElement.textContent = "--";
        }
    }
}

async function loadAthleteCount() {
    try {
        const usersSnap = await getDocs(
            query(collection(db, "users"), where("role", "==", "player"))
        );
        console.log(`Found ${usersSnap.size} athletes`);

        const athleteElement = document.getElementById("athlete-count");
        if (athleteElement) {
            athleteElement.textContent = usersSnap.size;
        }
    } catch (e) {
        console.warn("Failed to load athlete count:", e);
        const athleteElement = document.getElementById("athlete-count");
        if (athleteElement) {
            athleteElement.textContent = "--";
        }
    }
}

async function loadRecentResults() {
    try {
        // Get all completed matches
        const matchesSnap = await getDocs(
            query(collection(db, "matches"), where("status", "==", "final"))
        );

        const container = document.getElementById("recent-results");
        if (!container) return;

        container.innerHTML = "";

        if (matchesSnap.empty) {
            container.innerHTML =
                '<div class="text-gray-500 text-center py-4">No completed matches yet</div>';
            return;
        }

        // Filter to only real teams and sort by scheduled time (most recent first)
        const realMatches = matchesSnap.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            // .filter((match) => hasRealTeams(match))
            .sort((a, b) => {
                if (a.scheduled_at && b.scheduled_at) {
                    return (
                        b.scheduled_at.toMillis() - a.scheduled_at.toMillis()
                    );
                }
                return 0;
            })
            .slice(0, 3);

        console.log(`Found ${realMatches.length} recent real matches`);

        if (realMatches.length === 0) {
            container.innerHTML =
                '<div class="text-gray-500 text-center py-4">No completed matches yet</div>';
            return;
        }

        // 🔥 RESOLVE TEAM NAMES - This was missing!
        const matchesWithNames = await Promise.all(
            realMatches.map((match) => resolveMatchTeamNames(match))
        );

        matchesWithNames.forEach((match) => {
            // Format match time
            let timeDisplay = "";
            if (match.scheduled_at) {
                const date = match.scheduled_at.toDate();
                timeDisplay =
                    date.toLocaleDateString() +
                    " " +
                    date.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                    });
            }

            const resultHtml = `
                <div class="border-l-4 border-primary pl-4 py-2">
                    <div class="font-medium">${match.teamADisplayName} vs ${
                match.teamBDisplayName
            }</div>
                    <div class="text-sm text-gray-600">
                        ${match.event_id} • Score: ${match.score_a || 0}-${
                match.score_b || 0
            }
                        ${timeDisplay ? ` • ${timeDisplay}` : ""}
                    </div>
                </div>
            `;
            container.innerHTML += resultHtml;
        });
    } catch (e) {
        console.warn("Failed to load recent results:", e);
        const container = document.getElementById("recent-results");
        if (container) {
            container.innerHTML =
                '<div class="text-gray-500 text-center py-4">Unable to load results</div>';
        }
    }
}

async function loadUpcomingMatches() {
    try {
        // Get all scheduled matches
        const matchesSnap = await getDocs(
            query(collection(db, "matches"), where("status", "==", "scheduled"))
        );

        const container = document.getElementById("upcoming-matches");
        if (!container) return;

        container.innerHTML = "";

        if (matchesSnap.empty) {
            container.innerHTML =
                '<div class="text-gray-500 text-center py-4">No upcoming matches</div>';
            return;
        }

        // Get all matches
        const allMatches = matchesSnap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        console.log("=== ALL SCHEDULED MATCHES ===");
        allMatches.forEach((match) => {
            const time = match.scheduled_at
                ? match.scheduled_at.toDate().toLocaleString()
                : "No time";
            console.log(
                `${match.competitor_a?.id} vs ${match.competitor_b?.id} | ${time} | ${match.event_id}`
            );
        });

        // 🔥 RESOLVE TEAM NAMES FIRST
        console.log("🔄 Resolving team names for all matches...");
        const matchesWithNames = await Promise.all(
            allMatches.map((match) => resolveMatchTeamNames(match))
        );

        // 🔥 THEN FILTER BASED ON RESOLVED NAMES
        const realMatches = matchesWithNames
            .filter((match) => {
                // Check if resolved names are real teams (not placeholders)
                const teamAReal = !isPlaceholder(match.teamADisplayName);
                const teamBReal = !isPlaceholder(match.teamBDisplayName);
                const hasReal = teamAReal && teamBReal;

                console.log(
                    `${match.competitor_a?.id} → ${match.teamADisplayName} (real: ${teamAReal})`
                );
                console.log(
                    `${match.competitor_b?.id} → ${match.teamBDisplayName} (real: ${teamBReal})`
                );
                console.log(`Match included: ${hasReal}\n`);

                return hasReal;
            })
            .sort((a, b) => {
                if (a.scheduled_at && b.scheduled_at) {
                    return (
                        a.scheduled_at.toMillis() - b.scheduled_at.toMillis()
                    );
                }
                return 0;
            })
            .slice(0, 3);

        console.log("=== FINAL 3 MATCHES ===");
        realMatches.forEach((match) => {
            const time = match.scheduled_at
                ? match.scheduled_at.toDate().toLocaleString()
                : "No time";
            console.log(
                `${match.teamADisplayName} vs ${match.teamBDisplayName} | ${time}`
            );
        });

        if (realMatches.length === 0) {
            container.innerHTML =
                '<div class="text-gray-500 text-center py-4">No upcoming matches with confirmed teams</div>';
            return;
        }

        // Display the matches (they already have resolved names)
        realMatches.forEach((match) => {
            let timeDisplay = "TBD";
            if (match.scheduled_at) {
                const date = match.scheduled_at.toDate();
                timeDisplay =
                    date.toLocaleDateString() +
                    " " +
                    date.toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                    });
            }

            const matchHtml = `
                <div class="border-l-4 border-accent pl-4 py-2">
                    <div class="font-medium">${match.teamADisplayName} vs ${
                match.teamBDisplayName
            }</div>
                    <div class="text-sm text-gray-600">
                        ${match.event_id} • ${timeDisplay}
                        ${match.venue ? ` • ${match.venue}` : ""}
                    </div>
                </div>
            `;
            container.innerHTML += matchHtml;
        });
    } catch (e) {
        console.warn("Failed to load upcoming matches:", e);
        const container = document.getElementById("upcoming-matches");
        if (container) {
            container.innerHTML =
                '<div class="text-gray-500 text-center py-4">Unable to load schedule</div>';
        }
    }
}

// Helper function for event-scoped team name resolution (from matches.js)
const cache = new Map();

async function resolveTeamName(eventId, competitorId) {
    if (!competitorId) return competitorId;

    const cacheKey = `${eventId}__${competitorId}`;
    if (cache.has(cacheKey)) return cache.get(cacheKey);

    try {
        // Try namespaced first (new format)
        const namespacedId = `${eventId}__${competitorId}`;
        console.log(`Looking for team document: ${namespacedId}`); // Debug log

        let snap = await getDocs(
            query(
                collection(db, "teams"),
                where("__name__", "==", namespacedId)
            )
        );

        // Fall back to legacy format
        if (snap.empty) {
            console.log(`Namespaced not found, trying legacy: ${competitorId}`); // Debug log
            snap = await getDocs(
                query(
                    collection(db, "teams"),
                    where("name", "==", competitorId)
                )
            );
        }

        if (!snap.empty) {
            const teamData = snap.docs[0].data();
            console.log(`Found team data:`, teamData); // Debug log
            const name = teamData.name;
            cache.set(cacheKey, name);
            return name;
        } else {
            console.warn(
                `No team found for ${namespacedId} or ${competitorId}`
            ); // Debug log
            cache.set(cacheKey, competitorId);
            return competitorId;
        }
    } catch (error) {
        console.warn(`Failed to resolve team name for ${competitorId}:`, error);
        cache.set(cacheKey, competitorId);
        return competitorId;
    }
}

// Helper function to resolve both team names for a match
async function resolveMatchTeamNames(match) {
    const [teamAName, teamBName] = await Promise.all([
        resolveTeamName(match.event_id, match.competitor_a?.id),
        resolveTeamName(match.event_id, match.competitor_b?.id),
    ]);

    return {
        ...match,
        teamADisplayName: teamAName,
        teamBDisplayName: teamBName,
    };
}

// Enhanced setupQuickActions that waits for auth if needed
async function setupQuickActions() {
    const userActionsDiv = document.getElementById("user-actions");
    if (!userActionsDiv) return;

    try {
        // Wait for auth to be ready if currentUser is null
        let user = auth.currentUser;
        if (!user) {
            console.log("Waiting for auth state...");
            // Wait up to 3 seconds for auth to initialize
            await new Promise((resolve) => {
                const unsubscribe = onAuthStateChanged(auth, (authUser) => {
                    unsubscribe();
                    user = authUser;
                    resolve();
                });
                // Timeout fallback
                setTimeout(resolve, 3000);
            });
        }

        if (!user) {
            console.log("No authenticated user found");
            userActionsDiv.classList.add("hidden");
            return;
        }

        console.log("Setting up quick actions for user:", user.uid);

        // Get user role from users collection
        const userDoc = await getDoc(doc(db, "users", user.uid));
        const userData = userDoc.exists() ? userDoc.data() : {};

        // Default to 'player' if no role is assigned or user document doesn't exist
        const userRole = userData.role || "player";

        console.log(`User role: ${userRole} (from userData:`, userData, `)`);

        // Show the Quick Actions section
        userActionsDiv.classList.remove("hidden");

        // Generate role-specific actions
        const actionsContainer = userActionsDiv.querySelector(".flex");
        if (actionsContainer) {
            actionsContainer.innerHTML = generateQuickActions(userRole);
        }
    } catch (error) {
        console.warn("Failed to setup quick actions:", error);
        // Show default player actions even if there's an error
        const actionsContainer = userActionsDiv.querySelector(".flex");
        if (actionsContainer) {
            actionsContainer.innerHTML = generateQuickActions("player");
        }
        userActionsDiv.classList.remove("hidden");
    }
}

// Generate Quick Actions HTML based on user role
function generateQuickActions(userRole) {
    const baseActions = {
        // Default for players/participants (users without specific roles)
        player: [
            {
                href: "dashboard.html",
                text: "View Dashboard",
                class: "bg-primary text-white",
                icon: "🏸",
            },
            {
                href: "mymatches.html",
                text: "My Matches",
                class: "bg-green-600 text-white",
                icon: "📊",
            },
            {
                href: "mystats.html",
                text: "My Stats",
                class: "bg-gray-600 text-white",
                icon: "🏃‍♂️",
            },
        ],
        scorekeeper: [
            {
                href: "dashboard.html",
                text: "View Dashboard",
                class: "bg-primary text-white",
                icon: "📋",
            },
            {
                href: "matches-and-results.html",
                text: "Matches and Results",
                class: "bg-green-600 text-white",
                icon: "⚡",
            },
            {
                href: "scorekeeper.html",
                text: "Manage Scores",
                class: "bg-gray-600 text-white",
                icon: "🏃‍♂️",
            },
        ],
        admin: [
            {
                href: "dashboard.html",
                text: "View Dashboard",
                class: "bg-primary text-white",
                icon: "👑",
            },
            {
                href: "scorekeeper.html",
                text: "Manage Scores",
                class: "bg-green-600 text-white",
                icon: "⚡",
            },
            {
                href: "controls.html",
                text: "Admin Controls",
                class: "bg-gray-600 text-white",
                icon: "⚙️",
            },
        ],
    };

    // Default to 'player' actions if role is undefined, null, or not found
    const actions = baseActions[userRole] || baseActions.player;

    return actions
        .map(
            (action) => `
        <a
            href="${action.href}"
            class="${action.class} px-4 py-2 rounded hover:opacity-90 transition flex items-center gap-2"
        >
            <span>${action.icon}</span>
            ${action.text}
        </a>
    `
        )
        .join("");
}

// Show user actions for authenticated users
onAuthStateChanged(auth, (user) => {
    const userActions = document.getElementById("user-actions");
    if (user && userActions) {
        userActions.classList.remove("hidden");
    }
});

// Load data when page loads
document.addEventListener("DOMContentLoaded", () => {
    console.log("DOM loaded, starting homepage data load...");
    loadHomepageData();
});
