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
        return "user";
    }
    return docSnap.data().role || "user";
}

let wired = false;
let authStateVersion = 0;
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
    let lastFocusedElement = null;

    const openModal = () => {
        lastFocusedElement = document.activeElement;
        modal.classList.remove("hidden");
        document.body.classList.add("sf-modal-open");
        window.requestAnimationFrame(() => emailInput?.focus());
    };

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
        document.body.classList.remove("sf-modal-open");
        errP.classList.add("hidden");
        emailInput.value = passInput.value = "";
        lastFocusedElement?.focus?.();
    };

    window.handleModalLogin = async () => {
        errP.classList.add("hidden");
        try {
            const userCred = await signInWithEmailAndPassword(
                auth,
                emailInput.value,
                passInput.value
            );
            const role = await setUserRole(userCred.user);
            window.SportsFiestaAuthUI?.write({
                status: "authenticated",
                uid: userCred.user.uid,
                role,
            });
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
                openModal();
            })
    );

    // Logout handlers with page refresh
    logoutLinks.forEach(
        (a) =>
            (a.onclick = async (e) => {
                e.preventDefault();
                const loggedOutState = window.SportsFiestaAuthUI?.write({
                    status: "unauthenticated",
                });
                window.SportsFiestaAuthUI?.renderNav(
                    document,
                    loggedOutState
                );
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
        const stateVersion = ++authStateVersion;
        if (user) {
            const cachedState = window.SportsFiestaAuthUI?.read();
            const cachedRole =
                cachedState?.status === "authenticated" &&
                cachedState.uid === user.uid
                    ? cachedState.role
                    : "user";

            // Firebase has confirmed the user immediately. Show authenticated
            // controls now; the role-specific label can be refined below.
            const initialState = window.SportsFiestaAuthUI?.write({
                status: "authenticated",
                uid: user.uid,
                role: cachedRole,
            });
            applyAuthenticatedState(initialState?.role || cachedRole);

            let role = cachedRole;
            try {
                const userRef = doc(db, "users", user.uid);
                const docSnap = await getDoc(userRef);
                role = docSnap.exists() ? docSnap.data().role || "user" : "user";
            } catch (error) {
                console.warn("Unable to refresh the user's role:", error);
            }

            // Ignore a role request that completed after a sign-out or account
            // switch, otherwise stale network responses can repaint the nav.
            if (
                stateVersion !== authStateVersion ||
                auth.currentUser?.uid !== user.uid
            ) {
                return;
            }

            const confirmedState = window.SportsFiestaAuthUI?.write({
                status: "authenticated",
                uid: user.uid,
                role,
            });

            console.log(
                `Auth state changed: User logged in with role: ${role}`
            );
            applyAuthenticatedState(confirmedState?.role || role);
        } else {
            console.log("Auth state changed: User logged out");

            const loggedOutState = window.SportsFiestaAuthUI?.write({
                status: "unauthenticated",
            });
            window.SportsFiestaAuthUI?.renderNav(
                document,
                loggedOutState
            );

            authLinks.forEach((a) => {
                a.onclick = (e) => {
                    e.preventDefault();
                    openModal();
                };
            });
        }
    });

    function applyAuthenticatedState(role) {
        window.SportsFiestaAuthUI?.renderNav(document, {
            status: "authenticated",
            role,
        });
        authLinks.forEach((a) => {
            a.onclick = (e) => {
                e.preventDefault();
                window.location = "dashboard.html";
            };
        });
    }
}

// Run after nav injection, and try immediately
document.addEventListener("nav-loaded", initAuth);
initAuth();
