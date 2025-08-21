// /public/js/first-visit-notice.js
// Shows a one-time modal for anonymous visitors.
// Bump NOTICE_ID any time you want everyone to see a new notice.

const NOTICE_ID = "login-tip-2025-v1";
const KEY = `notice.seen.${NOTICE_ID}`;

// Optional: allow ?resetNotice=1 to test again
const params = new URLSearchParams(location.search);
if (params.get("resetNotice") === "1") {
    try {
        localStorage.removeItem(KEY);
    } catch {}
}

function hasSeen() {
    try {
        return !!localStorage.getItem(KEY);
    } catch {
        return false;
    }
}
function markSeen() {
    try {
        localStorage.setItem(KEY, String(Date.now()));
    } catch {}
}

function show() {
    const modal = document.getElementById("firstVisitNotice");
    if (modal) modal.classList.remove("hidden");
}
function hide() {
    const modal = document.getElementById("firstVisitNotice");
    if (modal) modal.classList.add("hidden");
}

function wireUi() {
    const modal = document.getElementById("firstVisitNotice");
    if (!modal) return;

    const closeBtn = document.getElementById("noticeClose");
    const okBtn = document.getElementById("noticeOk");
    const signinBtn = document.getElementById("noticeSignin");

    const finish = () => {
        hide();
        markSeen();
    };

    closeBtn?.addEventListener("click", finish);
    okBtn?.addEventListener("click", finish);
    // If they click Sign in, also mark seen so we don't nag after login
    signinBtn?.addEventListener("click", markSeen);

    // Click outside to close
    modal.addEventListener("click", (e) => {
        if (e.target === modal) finish();
    });
}

document.addEventListener("DOMContentLoaded", () => {
    wireUi();

    // Wait for Firebase Auth (don’t flash the modal if user is already signed in)
    const auth = window.firebase?.auth;
    const tryShow = (user) => {
        if (user) return; // logged in → do not show
        if (!hasSeen()) show(); // anon + not seen → show once
    };

    if (auth?.onAuthStateChanged) {
        auth.onAuthStateChanged(tryShow);
    } else {
        // Fallback if auth isn’t present on this page
        tryShow(null);
    }
});
