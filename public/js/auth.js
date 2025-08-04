// public/js/auth.js
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const auth = window.firebase.auth;

let wired = false;
function initAuth() {
    if (wired) return;

    // Grab all Login/Logout links (desktop + mobile)
    const authLinks = Array.from(document.querySelectorAll(".auth-menu-btn"));
    const logoutLinks = Array.from(document.querySelectorAll(".logout-btn"));

    // Modal elements
    const modal = document.getElementById("login-modal");
    const emailInput = document.getElementById("modal-email");
    const passInput = document.getElementById("modal-pass");
    const forgotBtn = document.getElementById("forgot-btn");
    const errP = document.getElementById("modal-error");

    if (!modal || authLinks.length === 0) return; // nav not injected yet
    wired = true;

    // Backdrop/Escape close
    modal.addEventListener("click", (e) => {
        if (e.target === modal) closeModal();
    });
    document.addEventListener("keydown", (e) => {
        if (!modal.classList.contains("hidden") && e.key === "Escape")
            closeModal();
    });

    function showMsg(text, good = false) {
        errP.textContent = text;
        errP.classList.remove("hidden");
        errP.classList.toggle("text-green-600", good);
        errP.classList.toggle("text-red-600", !good);
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
            if (e.code === "auth/too-many-requests") {
                showMsg("Too many attempts. Try again later.");
            } else {
                showMsg("Incorrect email/password.");
            }
        }
    };

    // Forgot password (neutral messaging)
    if (forgotBtn) {
        forgotBtn.onclick = async () => {
            const email = emailInput.value.trim();
            if (!email) {
                showMsg("Enter your email first.");
                return;
            }
            try {
                await sendPasswordResetEmail(auth, email);
                showMsg(
                    "If an account exists for that email, we’ve sent a reset link. If you did not receive it, please check your spam.",
                    true
                );
            } catch (e) {
                if (e.code === "auth/invalid-email") {
                    showMsg("Enter a valid email address.");
                } else {
                    showMsg(
                        "If an account exists for that email, we’ve sent a reset link. If you did not receive it, please check your spam.",
                        true
                    );
                }
            }
        };
    }

    // Default: all login links open modal (works before auth state arrives)
    authLinks.forEach(
        (a) =>
            (a.onclick = (e) => {
                e.preventDefault();
                modal.classList.remove("hidden");
            })
    );

    // Logout handlers
    logoutLinks.forEach(
        (a) =>
            (a.onclick = async (e) => {
                e.preventDefault();
                await signOut(auth);
            })
    );

    // Swap both sets of links based on auth state
    onAuthStateChanged(auth, (user) => {
        if (user) {
            authLinks.forEach((a) => {
                a.textContent = "My Dashboard";
                a.onclick = (e) => {
                    e.preventDefault();
                    window.location = "dashboard.html";
                };
            });
            logoutLinks.forEach((a) => a.classList.remove("hidden"));
        } else {
            authLinks.forEach((a) => {
                a.textContent = "Login";
                a.onclick = (e) => {
                    e.preventDefault();
                    modal.classList.remove("hidden");
                };
            });
            logoutLinks.forEach((a) => a.classList.add("hidden"));
        }
    });
}

// Run after nav injection, and try immediately
document.addEventListener("nav-loaded", initAuth);
initAuth();
