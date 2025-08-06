/*  public/js/scorekeeper.js  (v 6)
    ----------------------------------------------------------------
    + Event selector → filters the match list
    + remembers last event & match in sessionStorage
    + keeps all previous v5 features (swap-sides lock, live sync, …)
------------------------------------------------------------------ */

import {
    collection,
    query,
    where,
    orderBy,
    getDocs,
    doc,
    onSnapshot,
    updateDoc,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const { db, auth } = window.firebase;

/* ───── quick DOM ───── */
const $ = (id) => document.getElementById(id);
const msg = $("msg");
const evt = $("eventSelect");
const sel = $("matchSelect");
const load = $("loadBtn");
const pane = $("panel");
const label = $("matchLabel");
const redT = $("redTeam");
const blueT = $("blueTeam");
const sA = $("scoreA");
const sB = $("scoreB");
const timer = $("timer");
const start = $("startBtn");
const end = $("endBtn");

/* state */
let docRef = null; // current match doc ref
let unsubLive = null; // listener to that doc
let interval = null; // countdown ticker
let flipped = false; // UI orientation
let origRed = "",
    origBlue = "";

/* helpers */
const pad = (n) => String(n).padStart(2, "0");
const fmt = (ts) =>
    `${ts.toDate().toLocaleDateString("en", {
        weekday: "short",
        day: "2-digit",
        month: "short",
    })} ` + `${pad(ts.toDate().getHours())}:${pad(ts.toDate().getMinutes())}`;
const err = (t) => {
    msg.textContent = t;
    msg.classList.remove("hidden");
};

/* ───── auth gate ───── */
onAuthStateChanged(auth, async (user) => {
    if (!user) return err("Please log in.");
    if ((await user.getIdTokenResult()).claims.role !== "scorekeeper")
        return err("Not a score-keeper account.");
    await populateEventDropdown(); // NEW
    resumeIfAny(); // try restore last event/match
});

/* ───── 1. populate Event dropdown ───── */
async function populateEventDropdown() {
    const snap = await getDocs(collection(db, "events"));
    snap.docs
        .map((d) => d.id)
        .sort()
        .forEach((id) => {
            evt.insertAdjacentHTML(
                "beforeend",
                `<option value="${id}">${id.replace(/_/g, " ")}</option>`
            );
        });
}

/* ───── 2. rebuild Match dropdown whenever Event changes ───── */
async function refreshMatchDropdown(eventId) {
    sel.innerHTML = "";
    load.disabled = true;
    hidePanel();

    if (!eventId) return; // "Choose an event…"

    const q = query(
        collection(db, "matches"),
        where("event_id", "==", eventId),
        where("status", "in", ["scheduled", "live"]),
        orderBy("scheduled_at")
    );
    const snap = await getDocs(q);

    if (!snap.size) {
        sel.insertAdjacentHTML(
            "beforeend",
            `<option value="">No matches available</option>`
        );
        return;
    }

    // Sort the results to fix match numbering
    const sortedDocs = snap.docs.sort((a, b) => {
        const aTime = a.data().scheduled_at.toMillis();
        const bTime = b.data().scheduled_at.toMillis();

        // If times are different, sort by time
        if (aTime !== bTime) {
            return aTime - bTime;
        }

        // If times are same, sort by match number
        const aMatch = extractMatchNumber(a.id);
        const bMatch = extractMatchNumber(b.id);
        return aMatch - bMatch;
    });

    sortedDocs.forEach((d) => {
        const m = d.data();
        sel.insertAdjacentHTML(
            "beforeend",
            `<option value="${d.id}">${d.id} – ${fmt(m.scheduled_at)} – ${
                m.venue
            }</option>`
        );
    });

    sel.selectedIndex = 0;
    load.disabled = false;
}

// Helper function to extract numeric part from match ID (add this near the top)
function extractMatchNumber(matchId) {
    // Extract number from IDs like "S-Q10", "D-F2", "S-SF1"
    const match = matchId.match(/(\d+)$/);
    return match ? parseInt(match[1]) : 0;
}

/* hook change */
evt.addEventListener("change", () => refreshMatchDropdown(evt.value));
sel.addEventListener("change", () => (load.disabled = !sel.value));

/* ───── 3. session-resume ───── */
async function resumeIfAny() {
    const lastEvt = sessionStorage.getItem("currentEvent");
    const lastMatch = sessionStorage.getItem("currentMatch");
    if (!lastEvt || !lastMatch) return;

    evt.value = lastEvt;
    await refreshMatchDropdown(lastEvt);
    sel.value = lastMatch;
    if (sel.value) loadMatch(lastMatch, true);
}

/* ───── load / display a match ───── */
load.addEventListener("click", () => sel.value && loadMatch(sel.value));

async function loadMatch(id, silent = false) {
    if (unsubLive) {
        unsubLive();
        unsubLive = null;
    }
    if (interval) {
        clearInterval(interval);
        interval = null;
    }

    const snap = await getDocs(
        query(collection(db, "matches"), where("__name__", "==", id))
    );
    const d = snap.docs[0];
    docRef = d.ref;

    /* remember in session */
    sessionStorage.setItem("currentEvent", evt.value);
    sessionStorage.setItem("currentMatch", id);

    const m = d.data();
    origRed = m.competitor_a.id;
    origBlue = m.competitor_b.id;
    flipped = false;
    renderNamesAndScores(m.score_a ?? 0, m.score_b ?? 0);

    label.textContent = `${id} · ${m.venue}`;
    timer.textContent = "10:00";

    if (m.status === "live") startHidden();
    else showStart();
    pane.classList.remove("hidden");

    unsubLive = onSnapshot(docRef, (s) => {
        const d = s.data();
        if (d.status === "final") finishUI();
        renderNamesAndScores(d.score_a ?? 0, d.score_b ?? 0);
    });

    if (!silent) msg.classList.add("hidden");
}

/* ───── helpers for names / scores / logical conversion ───── */
function renderNamesAndScores(a, b) {
    redT.textContent = flipped ? origBlue : origRed;
    blueT.textContent = flipped ? origRed : origBlue;
    sA.textContent = flipped ? b : a;
    sB.textContent = flipped ? a : b;
}
function logicalScores() {
    return flipped
        ? { score_a: Number(sB.textContent), score_b: Number(sA.textContent) }
        : { score_a: Number(sA.textContent), score_b: Number(sB.textContent) };
}

/* ───── editable timer before start ───── */
timer.addEventListener("click", () => {
    if (start.hidden) return;
    const v = prompt("Set countdown (mm:ss)", timer.textContent);
    if (v && /^\d{1,2}:\d{2}$/.test(v)) timer.textContent = v;
});

/* ───── swap-sides button (locked until start) ───── */
const swapBtn = document.createElement("button");
swapBtn.textContent = "Swap Sides";
swapBtn.className =
    "mt-3 px-3 py-1 rounded bg-blue-600 text-white opacity-40 cursor-not-allowed";
swapBtn.disabled = true;
swapBtn.onclick = () => {
    if (swapBtn.disabled) return;
    flipped = !flipped;
    [sA.textContent, sB.textContent] = [sB.textContent, sA.textContent];
    document.querySelectorAll(".scoreBtn").forEach((btn) => {
        btn.dataset.side = btn.dataset.side === "a" ? "b" : "a";
    });
    const { score_a, score_b } = logicalScores();
    renderNamesAndScores(score_a, score_b);
};
timer.parentNode.insertBefore(swapBtn, timer.nextSibling);

/* ───── score buttons (debounced live write) ───── */
let debounceTimer = null;
function pushLiveScores() {
    const { score_a, score_b } = logicalScores();
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(
        () => updateDoc(docRef, { score_a, score_b }),
        200
    );
}
document.querySelectorAll(".scoreBtn").forEach((btn) => {
    btn.addEventListener("click", () => {
        if (start.classList.contains("hidden") && !end.disabled) {
            const logical = btn.dataset.side === "a" ? 0 : 1;
            const span = flipped ? [sB, sA][logical] : [sA, sB][logical];
            span.textContent = Math.max(
                0,
                Number(span.textContent) + Number(btn.dataset.delta)
            );
            pushLiveScores();
        }
    });
});

/* ───── match control (start / end) ───── */
start.addEventListener("click", async () => {
    await updateDoc(docRef, {
        status: "live",
        actual_start: serverTimestamp(),
    });
    pushLiveScores();
    startHidden();
    countdown(toSeconds(timer.textContent));
});
end.addEventListener("click", async () => {
    if (end.disabled) return;
    clearInterval(interval);
    await updateDoc(docRef, { status: "final", ...logicalScores() });
    finishUI();
});

/* ───── misc ui helpers ───── */
function toSeconds(txt) {
    const [m, s] = txt.split(":").map(Number);
    return m * 60 + s;
}
function countdown(sec) {
    clearInterval(interval);
    const tick = () => {
        timer.textContent = `${pad((sec / 60) | 0)}:${pad(sec % 60)}`;
        if (sec-- <= 0) {
            clearInterval(interval);
        }
    };
    tick();
    interval = setInterval(tick, 1000);
}
function startHidden() {
    start.classList.add("hidden");
    end.classList.remove(
        "hidden",
        "bg-gray-800",
        "opacity-60",
        "cursor-default"
    );
    end.classList.add("bg-red-600", "hover:bg-red-700");
    end.disabled = false;
    swapBtn.disabled = false;
    swapBtn.classList.remove("opacity-40", "cursor-not-allowed");
}
function finishUI() {
    end.disabled = true;
    swapBtn.disabled = true;
    swapBtn.classList.add("opacity-40", "cursor-not-allowed");
    end.classList.remove("hover:bg-red-700", "bg-red-600");
    end.classList.add("bg-gray-800", "opacity-60", "cursor-default");
}
function showStart() {
    start.classList.remove("hidden", "opacity-60");
    end.classList.add("hidden");
    end.disabled = false;
}
function hidePanel() {
    pane.classList.add("hidden");
    if (unsubLive) {
        unsubLive();
        unsubLive = null;
    }
    if (interval) {
        clearInterval(interval);
        interval = null;
    }
}
