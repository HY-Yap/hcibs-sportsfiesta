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

// Event icons
const eventIcons = {
    badminton_singles: "🏸",
    badminton_doubles: "🏸",
    basketball3v3: "🏀",
    frisbee5v5: "🥏",
};

// Event display names
const eventNames = {
    badminton_singles: "Badminton Singles",
    badminton_doubles: "Badminton Doubles",
    basketball3v3: "Basketball 3v3",
    frisbee5v5: "Frisbee 5v5",
};

document.addEventListener("DOMContentLoaded", () => {
    loadAllTeams();
    setupTabHandlers();
});

async function loadAllTeams() {
    try {
        console.log("Loading all teams...");

        const teamsSnap = await getDocs(
            query(collection(db, "teams"), orderBy("event_id"), orderBy("name"))
        );

        allTeams = teamsSnap.docs.map((doc) => ({
            id: doc.id,
            ...doc.data(),
        }));

        console.log(`Loaded ${allTeams.length} teams`);

        document.getElementById("loading").style.display = "none";
        displayTeams(allTeams);
    } catch (error) {
        console.error("Error loading teams:", error);
        document.getElementById("loading").innerHTML =
            '<div class="text-red-500">Failed to load athletes</div>';
    }
}

function setupTabHandlers() {
    const tabButtons = document.querySelectorAll(".tab-button");

    tabButtons.forEach((button) => {
        button.addEventListener("click", () => {
            // Update active tab
            tabButtons.forEach((btn) => btn.classList.remove("active"));
            button.classList.add("active");

            // Get filter value
            const eventId = button.id.replace("tab-", "");
            currentFilter = eventId;

            // Filter and display teams
            const filteredTeams =
                eventId === "all"
                    ? allTeams
                    : allTeams.filter((team) => team.event_id === eventId);

            displayTeams(filteredTeams);
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
        playersHtml = team.member_names
            .map(
                (name) =>
                    `<span class="inline-block bg-gray-100 text-gray-800 px-2 py-1 rounded text-sm mr-1 mb-1">${name}</span>`
            )
            .join("");
    } else if (team.member_emails && team.member_emails.length > 0) {
        // Extract names from emails if member_names not available
        const names = team.member_emails.map((email) => {
            const username = email.split("@")[0];
            return username.charAt(0).toUpperCase() + username.slice(1);
        });
        playersHtml = names
            .map(
                (name) =>
                    `<span class="inline-block bg-gray-100 text-gray-800 px-2 py-1 rounded text-sm mr-1 mb-1">${name}</span>`
            )
            .join("");
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
`;
document.head.appendChild(style);
