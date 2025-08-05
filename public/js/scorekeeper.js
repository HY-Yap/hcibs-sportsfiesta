/*  public/js/scorekeeper.js  (v 5)
    ---------------------------------------------------------------
    – fixes Swap-Sides duplicate-name bug
    – streams score updates as they happen (debounced)
    – remembers current match in sessionStorage so a reload resumes
---------------------------------------------------------------- */

import {
    collection,
    query,
    where,
    orderBy,
    getDocs,
    doc,
    updateDoc,
    onSnapshot,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const { db, auth } = window.firebase;

/* ----------  quick DOM ---------- */
const $ = (id) => document.getElementById(id);
const msg = $("msg");
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

let docRef = null; // Firestore ref to current match
let unsubLiveSnap = null; // listener for live score / status
let interval = null; // countdown ticker
let flipped = false; // UI orientation
let origRed = "",
    origBlue = "";

/* ----------  helpers ---------- */
const pad = (n) => String(n).padStart(2, "0");
const fmt = (ts) => {
    const d = ts.toDate?.() ?? ts;
    return (
        `${d.toLocaleDateString("en", {
            weekday: "short",
            day: "2-digit",
            month: "short",
        })}` + ` ${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
};
const err = (t) => {
    msg.textContent = t;
    msg.classList.remove("hidden");
};

/* ----------  auth ---------- */
onAuthStateChanged(auth, async (user) => {
    if (!user) return err("Please log in.");
    if ((await user.getIdTokenResult()).claims.role !== "scorekeeper")
        return err("Not a score-keeper account.");
    await populateDropdown();
    resumeIfAny();
});

/* ----------  dropdown ---------- */
async function populateDropdown() {
    const snap = await getDocs(
        query(
            collection(db, "matches"),
            where("status", "in", ["scheduled", "live"]),
            orderBy("scheduled_at")
        )
    );
    if (!snap.size) return err("No matches available.");
    snap.forEach((d) => {
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

/* ----------  resume after refresh ---------- */
function resumeIfAny() {
    const id = sessionStorage.getItem("currentMatch");
    if (!id) return;
    sel.value = id;
    loadMatch(id, true); // silent=true
}

/* ----------  load match ---------- */
load.addEventListener("click", () => sel.value && loadMatch(sel.value));

async function loadMatch(id, silent = false) {
    /* clear previous listeners / timers */
    if (unsubLiveSnap) {
        unsubLiveSnap();
        unsubLiveSnap = null;
    }
    if (interval) {
        clearInterval(interval);
        interval = null;
    }

    const dSnap = (
        await getDocs(
            query(collection(db, "matches"), where("__name__", "==", id))
        )
    ).docs[0];

    docRef = dSnap.ref;
    sessionStorage.setItem("currentMatch", id);

    const m = dSnap.data();
    origRed = m.competitor_a.id;
    origBlue = m.competitor_b.id;
    flipped = false;

    renderNamesAndScores(m.score_a ?? 0, m.score_b ?? 0);

    label.textContent = `${id} · ${m.venue}`;
    timer.textContent = "10:00";
    if (m.status === "live") startHidden();
    else showStart();

    pane.classList.remove("hidden");

    /* listen live so UI reflects other clients’ updates */
    unsubLiveSnap = onSnapshot(docRef, (snap) => {
        const d = snap.data();
        /* if another scorer ended the match we respect it */
        if (d.status === "final") finishUI();
        renderNamesAndScores(d.score_a ?? 0, d.score_b ?? 0);
    });

    if (!silent) msg.classList.add("hidden");
}

/* ----------  name / score helpers ---------- */
function renderNamesAndScores(a, b) {
    redT.textContent = flipped ? origBlue : origRed;
    blueT.textContent = flipped ? origRed : origBlue;
    sA.textContent = flipped ? b : a;
    sB.textContent = flipped ? a : b;
}
function logicalScores() {
    /* translate UI scores back to logical A / B */
    return flipped
        ? { score_a: Number(sB.textContent), score_b: Number(sA.textContent) }
        : { score_a: Number(sA.textContent), score_b: Number(sB.textContent) };
}

/* ----------  editable timer ---------- */
timer.addEventListener("click", () => {
    if (start.hidden) return;
    const v = prompt("Set countdown (mm:ss)", timer.textContent);
    if (v && /^\d{1,2}:\d{2}$/.test(v)) timer.textContent = v;
});

/* ----------  swap sides ---------- */
const swapBtn = document.createElement("button");
swapBtn.textContent = "Swap Sides";
swapBtn.className =
    "mt-3 px-3 py-1 rounded bg-blue-600 text-white opacity-40 cursor-not-allowed";
swapBtn.disabled = true; // ‼  start locked
swapBtn.onclick = () => {
    if (swapBtn.disabled) return; // guard

    // flip orientation
    flipped = !flipped;
    [sA.textContent, sB.textContent] = [sB.textContent, sA.textContent];

    // swap button ownership so each +/– still drives the visible team
    document.querySelectorAll(".scoreBtn").forEach((btn) => {
        btn.dataset.side = btn.dataset.side === "a" ? "b" : "a";
    });

    // redraw names & scores in the new orientation
    const { score_a, score_b } = logicalScores(); // read current logical scores
    renderNamesAndScores(score_a, score_b);
};
timer.parentNode.insertBefore(swapBtn, timer.nextSibling);

/* ----------  score buttons ---------- */
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
            /* dataset.side = logical side ("a" / "b") */
            const logical = btn.dataset.side === "a" ? 0 : 1; // 0 → A, 1 → B
            const uiSpan = flipped
                ? [sB, sA][logical] // view swapped
                : [sA, sB][logical]; // normal

            uiSpan.textContent = Math.max(
                0,
                Number(uiSpan.textContent) + Number(btn.dataset.delta)
            );
            pushLiveScores(); // debounced Firestore write
        }
    });
});

/* ----------  match control ---------- */
start.addEventListener("click", async () => {
    await updateDoc(docRef, {
        status: "live",
        actual_start: serverTimestamp(),
    });
    pushLiveScores(); // write initial 0–0
    startHidden();
    countdown(parseClock(timer.textContent));
});
end.addEventListener("click", async () => {
    if (end.disabled) return;
    clearInterval(interval);
    await updateDoc(docRef, { status: "final", ...logicalScores() });
    finishUI();
});
function parseClock(t) {
    const [m, s] = t.split(":").map(Number);
    return m * 60 + s;
}
function countdown(sec) {
    clearInterval(interval);
    const tick = () => {
        if (sec <= 0) {
            clearInterval(interval);
            timer.textContent = "00:00";
            return;
        }
        timer.textContent = `${pad((sec / 60) | 0)}:${pad(sec % 60)}`;
        sec--;
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
    swapBtn.disabled = false; // ‼  enable swap
    swapBtn.classList.remove("opacity-40", "cursor-not-allowed");
}
function finishUI() {
    end.disabled = true;
    swapBtn.disabled = true; // ‼  lock swap again
    swapBtn.classList.add("opacity-40", "cursor-not-allowed");
    end.classList.remove("hover:bg-red-700", "bg-red-600");
    end.classList.add("bg-gray-800", "opacity-60", "cursor-default");
}
function showStart() {
    start.classList.remove("hidden", "opacity-60");
    end.classList.add("hidden");
    end.disabled = false;
}
