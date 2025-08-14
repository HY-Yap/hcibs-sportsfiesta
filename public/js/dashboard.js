
import { onAuthStateChanged, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./firebase-init.js";
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const sidebarTitleEl = document.getElementById("sidebar-title");
const sidebarNavEl = document.getElementById("sidebar-nav");
const dashboardTitleEl = document.getElementById("dashboard-title");
const mainContentEl = document.getElementById("main-content");
const sidebar = document.getElementById("sidebar");
const toggleBtn = document.getElementById("sidebar-toggle");
const overlay = document.getElementById("sidebar-overlay");

function renderSidebarLinks(role) {
  sidebarNavEl.innerHTML = "";
  // Always show profile
  sidebarNavEl.insertAdjacentHTML("beforeend",
    `<a href="dashboard.html" id="profile-link" class="block py-2 px-3 rounded hover:bg-accent/20 hover:text-accent font-semibold transition">My Profile</a>`
  );
  if (role === "player") {
    sidebarNavEl.insertAdjacentHTML("beforeend",
      `<a href="mymatches.html" id="matches-link" class="block py-2 px-3 rounded hover:bg-accent/20 hover:text-accent font-semibold transition">My Matches</a>`
    );
    sidebarNavEl.insertAdjacentHTML("beforeend",
      `<a href="mystats.html" id="stats-link" class="block py-2 px-3 rounded hover:bg-accent/20 hover:text-accent font-semibold transition">My Stats</a>`
    );
  }
  if (role === "scorekeeper" || role === "admin") {
    sidebarNavEl.insertAdjacentHTML("beforeend",
      `<a href="scorekeeper.html" id="edit-matches-link" class="block py-2 px-3 rounded hover:bg-accent/20 hover:text-accent font-semibold transition">Edit Matches</a>`
    );
  }
  if (role === "admin") {
    sidebarNavEl.insertAdjacentHTML("beforeend",
      `<a href="controls.html" id="admin-controls-link" class="block py-2 px-3 rounded hover:bg-accent/20 hover:text-accent font-semibold transition">Admin Controls</a>`
    );
  }
}

function renderMainContent(role, userData) {
  const fullName = userData.name || userData.displayName || userData.full_name || userData.email || auth.currentUser?.displayName || auth.currentUser?.email || "User";
  let profileSection = `
    <section class="bg-white rounded-lg shadow p-6 mb-6">
      <h2 class="text-2xl font-semibold text-gray-800 mb-2">Welcome, <span id="user-name">${fullName}</span></h2>
      <p class="text-gray-700 mb-1">Role: <span id="user-role">${role.charAt(0).toUpperCase() + role.slice(1)}</span></p>
  <p class="text-gray-700">Email: <span id="user-email">${userData.email || userData.userEmail || auth.currentUser?.email || ''}</span></p>
    </section>
  `;
  let eventsSection = "";
  if (role === "player") {
    eventsSection = `
      <section class="bg-white rounded-lg shadow p-6 mb-6">
        <h3 class="text-xl font-semibold text-gray-800 mb-4">Participating Events</h3>
        <ul id="events-list" class="space-y-3"></ul>
      </section>
    `;
  }
  let accountSection = `
    <section class="bg-white rounded-lg shadow p-6">
      <h3 class="text-xl font-semibold text-gray-800 mb-4">Account Settings</h3>
      <form id="change-password-form" class="space-y-4 max-w-md">
        <div>
          <label for="old-password" class="block text-gray-700 mb-1">Current Password</label>
          <input type="password" id="old-password" class="w-full p-2 border rounded hover:border-gray-500" required autocomplete="current-password" />
        </div>
        <div>
          <label for="new-password" class="block text-gray-700 mb-1">New Password</label>
          <input type="password" id="new-password" class="w-full p-2 border rounded hover:border-gray-500" required autocomplete="new-password" />
        </div>
        <div>
          <label for="confirm-password" class="block text-gray-700 mb-1">Confirm New Password</label>
          <input type="password" id="confirm-password" class="w-full p-2 border rounded hover:border-gray-500" required autocomplete="new-password" />
        </div>
        <button type="submit" class="bg-primary text-white px-4 py-2 rounded hover:bg-primary-dark transition">Change Password</button>
        <p id="change-password-msg" class="text-red-600 mt-2 hidden"></p>
      </form>
    </section>
  `;
  if (mainContentEl) mainContentEl.innerHTML = profileSection + eventsSection + accountSection;
}

function formatEventName(id){
  if(!id) return id;
  return id
    .replace(/badminton_singles/,'Badminton Singles')
    .replace(/badminton_doubles/,'Badminton Doubles')
    .replace(/frisbee5v5/,'Frisbee')
    .replace(/basketball3v3/,'Basketball')
    .replace(/_/g,' ');
}

function renderEventsDerived(list){
  const el = document.getElementById('events-list');
  if(!el) return;
  if(!list.length){
    el.innerHTML = '<li class="text-gray-500">No events found.</li>';
    return;
  }
  el.innerHTML='';
  list.forEach(ev => {
    el.insertAdjacentHTML('beforeend', `<li class="flex items-center gap-4 py-1">
      <span class="font-semibold">${formatEventName(ev.event_id)}</span>
      <span class="text-gray-600 text-sm">${ev.teamName ? 'Team: <span class=\\"font-bold\\">'+ev.teamName+'</span>' : 'Individual'}</span>
    </li>`);
  });
}

async function deriveUserEvents(user){
  const eventsMap = new Map(); // event_id -> {event_id, teamName?}
  // Team-based participation
  const teamsSnap = await getDocs(collection(db,'teams'));
  teamsSnap.forEach(tDoc => {
    const t = tDoc.data();
    if(t.member_emails && t.member_emails.includes(user.email)){
      eventsMap.set(t.event_id, { event_id: t.event_id, teamName: t.name || '' });
    }
  });
  // Individual matches participation
  const matchesSnap = await getDocs(collection(db,'matches'));
  matchesSnap.forEach(mDoc => {
    const m = mDoc.data();
    if(!m.event_id) return;
    const aId = m.competitor_a?.id; const bId = m.competitor_b?.id;
    const aEmail = m.competitor_a?.email; const bEmail = m.competitor_b?.email;
    if(aId === user.uid || bId === user.uid || aEmail === user.email || bEmail === user.email){
      if(!eventsMap.has(m.event_id)) eventsMap.set(m.event_id,{event_id:m.event_id});
    }
  });
  return Array.from(eventsMap.values()).sort((a,b)=> a.event_id.localeCompare(b.event_id));
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "/index.html";
    return;
  }
  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);
  let userData = userSnap.exists() ? userSnap.data() : {};
  const role = userData.role || "user";

  // Set titles
  if (sidebarTitleEl) {
    if (role === "admin") sidebarTitleEl.textContent = "Admin Dashboard";
    else if (role === "scorekeeper") sidebarTitleEl.textContent = "Scorekeeper Dashboard";
    else sidebarTitleEl.textContent = "User Dashboard";
  }
  if (dashboardTitleEl) {
    if (role === "admin") dashboardTitleEl.textContent = "Admin Dashboard";
    else if (role === "scorekeeper") dashboardTitleEl.textContent = "Scorekeeper Dashboard";
    else dashboardTitleEl.textContent = "User Dashboard";
  }

  // Render sidebar always
  renderSidebarLinks(role);

  // Only render main dashboard content if #main-content exists
  if (mainContentEl) {
    renderMainContent(role, userData);
    if (role === 'player') {
      try {
        const evList = await deriveUserEvents(user);
        renderEventsDerived(evList);
      } catch(err){
        console.warn('Failed to derive events', err);
        renderEventsDerived([]);
      }
    }
  }

  // Password change logic (direct change)
  const changePasswordForm = document.getElementById("change-password-form");
  if (changePasswordForm) {
    changePasswordForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const oldPassword = document.getElementById("old-password").value;
      const newPassword = document.getElementById("new-password").value;
      const confirmPassword = document.getElementById("confirm-password").value;
      const msgEl = document.getElementById("change-password-msg");
      msgEl.classList.add("hidden");
      if (!oldPassword || !newPassword || !confirmPassword) {
        msgEl.textContent = "Please fill in all fields.";
        msgEl.classList.remove("hidden");
        return;
      }
      if (newPassword !== confirmPassword) {
        msgEl.textContent = "New passwords do not match.";
        msgEl.classList.remove("hidden");
        return;
      }
      if (newPassword.length < 6) {
        msgEl.textContent = "New password must be at least 6 characters.";
        msgEl.classList.remove("hidden");
        return;
      }
      const userObj = auth.currentUser;
      if (!userObj) {
        msgEl.textContent = "Please log in first.";
        msgEl.classList.remove("hidden");
        return;
      }
      // Re-authenticate user
      try {
        const credential = EmailAuthProvider.credential(userObj.email, oldPassword);
        await reauthenticateWithCredential(userObj, credential);
        await updatePassword(userObj, newPassword);
        msgEl.textContent = "Password changed successfully.";
        msgEl.classList.remove("hidden");
        msgEl.classList.remove("text-red-600");
        msgEl.classList.add("text-green-600");
        changePasswordForm.reset();
      } catch (err) {
        if (err.code === "auth/invalid-credential") {
          msgEl.textContent = "Current password is wrong.";
        } else {
          msgEl.textContent = err.message || "Failed to change password.";
        }
        msgEl.classList.remove("hidden");
        msgEl.classList.remove("text-green-600");
        msgEl.classList.add("text-red-600");
      }
    });
  }

  // Sidebar hamburger logic
  // (Removed per centralised sidebar.js controller to avoid double-binding)
});