// public/js/schedule.js
import {
    collection,
    query,
    where,
    getDocs,
    Timestamp,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const { db } = window.firebase; // grab the Firestore instance you set up in firebase-init.js
const tbody = document.querySelector("#sched tbody");

(async () => {
    // pull only "scheduled" matches
    const q = query(
        collection(db, "matches"),
        where("status", "==", "scheduled")
    );
    const snap = await getDocs(q);

    snap.forEach((doc) => {
        const m = doc.data();
        const tr = document.createElement("tr");
        tr.className = "hover:bg-gray-50";
        tr.innerHTML = `
      <td class="border p-2">${m.event_id}</td>
      <td class="border p-2">${m.competitor_a.id}</td>
      <td class="border p-2">${m.competitor_b.id}</td>
      <td class="border p-2">${fmt(m.scheduled_at)}</td>
      <td class="border p-2">${m.venue}</td>
    `;
        tbody.appendChild(tr);
    });
})();

function fmt(ts) {
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
