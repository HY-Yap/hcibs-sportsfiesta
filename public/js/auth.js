// public/js/auth.js

// 1) Load the Auth SDK
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// 2) Grab the instance
const auth = window.firebase.auth;

// 3) Auth setup function (waits for nav to exist)
function initAuth() {
    const authBtn = document.getElementById("auth-menu-btn");
    const modal = document.getElementById("login-modal");
    const emailInput = document.getElementById("modal-email");
    const passInput = document.getElementById("modal-pass");
    const errP = document.getElementById("modal-error");

    if (!authBtn || !modal) {
        // nav not yet in DOM
        return;
    }

    window.closeModal = () => {
        modal.classList.add("hidden");
        errP.classList.add("hidden");
        emailInput.value = passInput.value = "";
    };

    window.handleModalLogin = async () => {
        errP.classList.add("hidden");
        try {
            await signInWithEmailAndPassword(
                auth,
                emailInput.value,
                passInput.value
            );
            closeModal();
        } catch (e) {
            errP.textContent =
                {
                    "auth/invalid-email": "Invalid email.",
                    "auth/user-not-found": "No account found.",
                    "auth/wrong-password": "Wrong password.",
                    "auth/too-many-requests": "Too many attempts; try later.",
                }[e.code] || "Login failed.";
            errP.classList.remove("hidden");
        }
    };

    onAuthStateChanged(auth, (user) => {
        if (user) {
            authBtn.textContent = "My Dashboard";
            authBtn.onclick = () => (window.location = "dashboard.html");
        } else {
            authBtn.textContent = "Login";
            authBtn.onclick = () => modal.classList.remove("hidden");
        }
    });
}

// 4) Kick off when nav is injected
if (document.readyState === "complete") {
    initAuth();
} else {
    document.addEventListener("nav-loaded", initAuth);
}
