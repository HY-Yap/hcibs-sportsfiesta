import {
    collection,
    query,
    where,
    getDocs,
    Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const { db } = window.firebase;

// grab all scheduled matches
const q = query(collection(db, "matches"), where("status", "==", "scheduled"));
const snap = await getDocs(q);

const tbody = document.querySelector("#sched tbody");

snap.forEach((doc) => {
    const m = doc.data();

    const row = document.createElement("tr");
    row.innerHTML = `
    <td>${m.event_id}</td>
    <td>${m.competitor_a.id}</td>
    <td>${m.competitor_b.id}</td>
    <td>${formatTime(m.scheduled_at)}</td>
    <td>${m.venue}</td>
    `;
    tbody.appendChild(row);
});

function formatTime(ts) {
    if (ts instanceof Timestamp) {
        return ts.toDate().toLocaleString("en-SG", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        });
    }
    return "";
}
