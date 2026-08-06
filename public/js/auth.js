// public/js/auth.js
import {
    onAuthStateChanged,
    signInWithEmailAndPassword,
    signOut,
    sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
    doc,
    getDoc,
    setDoc,
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { db } from "./firebase-init.js";

const auth = window.firebase.auth;

async function setUserRole(user) {
    const userRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(userRef);
    if (!docSnap.exists()) {
        await setDoc(userRef, {
            role: "user",
            email: user.email,
        });
    }
}

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
            const userCred = await signInWithEmailAndPassword(
                auth,
                emailInput.value,
                passInput.value
            );
            await setUserRole(userCred.user);
            closeModal();

            // 🔥 Force page refresh to reload all personalized content
            console.log("Login successful, refreshing page...");
            window.location.reload();
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
                    "If an account exists for that email, we've sent a reset link. If you did not receive it, please check your spam.",
                    true
                );
            } catch (e) {
                if (e.code === "auth/invalid-email") {
                    showMsg("Enter a valid email address.");
                } else {
                    showMsg(
                        "If an account exists for that email, we've sent a reset link. If you did not receive it, please check your spam.",
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

    // Logout handlers with page refresh
    logoutLinks.forEach(
        (a) =>
            (a.onclick = async (e) => {
                e.preventDefault();
                try {
                    await signOut(auth);

                    // 🔥 Force page refresh to clear all personalized content
                    console.log("Logout successful, refreshing page...");
                    window.location.reload();
                } catch (error) {
                    console.error("Logout error:", error);
                    // Still refresh even if there's an error
                    window.location.reload();
                }
            })
    );

    // Swap both sets of links based on auth state
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            const userRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(userRef);
            const role = docSnap.exists() ? docSnap.data().role : "user";

            console.log(
                `Auth state changed: User logged in with role: ${role}`
            );

            authLinks.forEach((a) => {
                if (role === "admin") {
                    a.textContent = "Admin Dashboard";
                    a.onclick = (e) => {
                        e.preventDefault();
                        window.location = "dashboard.html";
                    };
                } else if (role === "scorekeeper") {
                    a.textContent = "Scorekeeper Dashboard";
                    a.onclick = (e) => {
                        e.preventDefault();
                        window.location = "dashboard.html";
                    };
                } else {
                    // default user
                    a.textContent = "My Dashboard";
                    a.onclick = (e) => {
                        e.preventDefault();
                        window.location = "dashboard.html";
                    };
                }
            });

            logoutLinks.forEach((a) => a.classList.remove("hidden"));
        } else {
            console.log("Auth state changed: User logged out");

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
