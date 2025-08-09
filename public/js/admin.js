// public/js/admin.js
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/index.html";
    return;
  }

  const userRef = doc(db, "users", user.uid);
  const docSnap = await getDoc(userRef);
  const role = docSnap.exists() ? docSnap.data().role : "user";

  if (role !== "admin") {
    alert("Access denied. Admins only.");
    if (role === "user") window.location.href = "/dashboard.html";
    else if (role === "scorekeeper") window.location.href = "/sk-dashboard.html";
    else window.location.href = "/index.html";
    return;
  }

  document.body.style.display = "block";
});

const sidebar = document.getElementById("sidebar");
const toggleBtn = document.getElementById("sidebar-toggle");
const overlay = document.getElementById("sidebar-overlay");

if (toggleBtn && sidebar && overlay) {
  toggleBtn.addEventListener("click", () => {
    sidebar.classList.toggle("-translate-x-full");
    overlay.classList.toggle("hidden");
    toggleBtn.classList.add("hidden"); // Hide hamburger when sidebar is open
  });

  overlay.addEventListener("click", () => {
    sidebar.classList.add("-translate-x-full");
    overlay.classList.add("hidden");
    toggleBtn.classList.remove("hidden"); // Show hamburger when sidebar is closed
  });
}