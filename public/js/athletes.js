// js/athletes.js
import { db } from "./firebase-init.js";
import {
    collection,
    getDocs,
    query,
    where,
    orderBy,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

let allTeams = [];
let currentFilter = "all";
let currentBadmintonSubFilter = "badminton_singles_male";
let emailToName = {}; // email -> full name mapping

const looksLikeEmail = (value) =>
    typeof value === "string" && /.+@.+\..+/.test(value.trim());

function resolveDisplayName(value) {
    const raw = String(value || "").trim();
    if (!raw) return "Unknown";

    if (looksLikeEmail(raw)) {
        const key = raw.toLowerCase();
        if (emailToName[key]) return emailToName[key];
        const username = raw.split("@")[0];
        return username.charAt(0).toUpperCase() + username.slice(1);
    }

    return raw;
}

// Event icons
const eventIcons = {
    badminton_singles: "🏸",
    badminton_doubles: "🏸",
    badminton_singles_male: "🏸",
    badminton_singles_female: "🏸",
    badminton_doubles_male: "🏸",
    badminton_doubles_female: "🏸",
    basketball3v3: "🏀",
    frisbee5v5: "🥏",
    volleyball: "🏐",
};

// Event display names
const eventNames = {
    badminton_singles: "Badminton Singles",
    badminton_doubles: "Badminton Doubles",
    badminton_singles_male: "Badminton Single Male",
    badminton_singles_female: "Badminton Single Female",
    badminton_doubles_male: "Badminton Double Male",
    badminton_doubles_female: "Badminton Double Female",
    basketball3v3: "Basketball 3v3",
    frisbee5v5: "Frisbee 5v5",
    volleyball: "Volleyball",
};

document.addEventListener("DOMContentLoaded", async () => {
    console.log("DOM loaded, starting athletes.js");
    
    // Check if required elements exist
    const loadingElement = document.getElementById("loading");
    const containerElement = document.getElementById("athletes-container");
    
    if (!loadingElement || !containerElement) {
        console.error("Required DOM elements not found:", {
            loading: !!loadingElement,
            container: !!containerElement
        });
        return;
    }
    
    setupTabHandlers();
    await loadAllTeams();
});

async function loadAllTeams() {
    try {
        console.log("Loading all teams...");
        
        // Check if Firebase is initialized
        if (!db) {
            throw new Error("Firebase database not initialized");
        }

        const teamsSnap = await getDocs(collection(db, "teams"));

        // Build email set to optionally limit user lookup (we'll just load all users if small dataset)
        const emailSet = new Set();
        teamsSnap.forEach(doc => {
            const data = doc.data() || {};
            (data.member_emails || []).forEach(e => emailSet.add(e));
        });

        // Attempt to load user profiles for full names
        try {
            const usersSnap = await getDocs(collection(db, "users"));
            usersSnap.forEach(uDoc => {
                const u = uDoc.data() || {};
                const email = (u.email || u.userEmail || "").toLowerCase();
                if (!email) return;
                // Only store if part of any team (to keep map minimal)
                if (emailSet.size === 0 || emailSet.has(email)) {
                    emailToName[email] = u.full_name || u.name || u.displayName || email.split("@")[0];
                }
            });
        } catch (userErr) {
            console.warn("Could not load users collection for full names, falling back to email prefixes:", userErr);
        }

        allTeams = teamsSnap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        // Sort in JavaScript instead of Firestore to avoid index requirements
        allTeams.sort((a, b) => {
            if (a.event_id !== b.event_id) {
                return a.event_id.localeCompare(b.event_id);
            }
            return (a.name || '').localeCompare(b.name || '');
        });

        console.log(`Loaded ${allTeams.length} teams`);

        const loadingElement = document.getElementById("loading");
        if (loadingElement) {
            loadingElement.style.display = "none";
        }
        
        displayTeams(allTeams);
    } catch (error) {
        console.error("Error loading teams:", error);
        
        const loadingElement = document.getElementById("loading");
        if (loadingElement) {
            loadingElement.innerHTML =
                `<div class="text-red-500">
                    <p class="font-semibold">Failed to load athletes</p>
                    <p class="text-sm mt-2">Error: ${error.message}</p>
                    <p class="text-xs mt-1 text-gray-600">Check console for details</p>
                </div>`;
        }
    }
}

function setupTabHandlers() {
    const tabButtons = document.querySelectorAll(".tab-button");
    const badmintonSubtabs = document.querySelectorAll(".badminton-subtab");
    const badmintonSubtabsWrap = document.getElementById("badminton-subtabs");

    const activate = (arr, activeEl, className = "active") => {
        arr.forEach((el) => el.classList.remove(className));
        activeEl?.classList.add(className);
    };

    const applyFilter = (eventId) => {
        currentFilter = eventId;
        const filteredTeams =
            eventId === "all"
                ? allTeams
                : allTeams.filter((team) => team.event_id === eventId);
        displayTeams(filteredTeams);
    };

    tabButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const eventId = button.id.replace("tab-", "");

            activate(tabButtons, button);

            if (eventId === "badminton") {
                badmintonSubtabsWrap?.classList.remove("hidden");
                const activeSub = document.getElementById(
                    `tab-${currentBadmintonSubFilter}`
                );
                activate(badmintonSubtabs, activeSub, "active-subtab");
                applyFilter(currentBadmintonSubFilter);
                return;
            }

            badmintonSubtabsWrap?.classList.add("hidden");
            applyFilter(eventId);
        });
    });

    badmintonSubtabs.forEach((subtabBtn) => {
        subtabBtn.addEventListener("click", () => {
            const subEventId = subtabBtn.id.replace("tab-", "");
            currentBadmintonSubFilter = subEventId;
            activate(badmintonSubtabs, subtabBtn, "active-subtab");

            const badmintonTop = document.getElementById("tab-badminton");
            if (badmintonTop?.classList.contains("active")) {
                applyFilter(subEventId);
            }
        });
    });
}

function displayTeams(teams) {
    const container = document.getElementById("athletes-container");

    if (teams.length === 0) {
        container.innerHTML = `
            <div class="col-span-full text-center py-8 text-gray-500">
                No teams found for this event.
            </div>
        `;
        return;
    }

    container.innerHTML = teams.map((team) => createTeamCard(team)).join("");
}

function createTeamCard(team) {
    const icon = eventIcons[team.event_id] || "🏆";
    const eventName = eventNames[team.event_id] || team.event_id;

    // Extract player names
    let playersHtml = "";
    if (team.member_names && team.member_names.length > 0) {
        const names = team.member_names.map((value) =>
            resolveDisplayName(value)
        );
        playersHtml = names
            .map(
                (name) =>
                    `<span class="inline-block bg-gray-100 text-gray-800 px-2 py-1 rounded text-sm mr-1 mb-1">${name}</span>`
            )
            .join("");
    } else if (team.member_emails && team.member_emails.length > 0) {
        // Convert emails to full names when available.
        const names = team.member_emails.map((value) =>
            resolveDisplayName(value)
        );
        playersHtml = names.map(
            (name) => `<span class="inline-block bg-gray-100 text-gray-800 px-2 py-1 rounded text-sm mr-1 mb-1">${name}</span>`
        ).join("");
    } else {
        playersHtml =
            '<span class="text-gray-500 text-sm">No members listed</span>';
    }

    const memberCount = team.member_emails ? team.member_emails.length : 0;

    return `
        <div class="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
            <!-- Team Header -->
            <div class="flex items-center justify-between mb-4">
                <div class="flex items-center">
                    <span class="text-2xl mr-2">${icon}</span>
                    <div>
                        <h3 class="font-bold text-lg text-gray-800">${
                            team.name
                        }</h3>
                        <p class="text-sm text-gray-600">${eventName}</p>
                    </div>
                </div>
                <span class="bg-primary text-white px-2 py-1 rounded text-sm">
                    ${memberCount} ${memberCount === 1 ? "player" : "players"}
                </span>
            </div>
            
            <!-- Team Members -->
            <div class="mb-4">
                <h4 class="font-medium text-gray-700 mb-2">Team Members:</h4>
                <div class="flex flex-wrap">
                    ${playersHtml}
                </div>
            </div>
            
            <!-- Team ID (for debugging) -->
            <div class="text-xs text-gray-400 border-t pt-2">
                ID: ${team.id}
            </div>
        </div>
    `;
}

// Add CSS for active tab
const style = document.createElement("style");
style.textContent = `
    .tab-button {
        color: #6b7280;
        background: transparent;
    }
    .tab-button:hover {
        color: #2563eb;
        background: #f3f4f6;
    }
    .tab-button.active {
        color: #2563eb;
        background: #dbeafe;
        font-weight: 600;
    }
    .badminton-subtab.active-subtab {
        color: #2563eb;
        border-color: #2563eb;
        background: #eff6ff;
        font-weight: 600;
    }
`;
document.head.appendChild(style);
