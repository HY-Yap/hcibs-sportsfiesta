import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDYSel3WBMz0bJEnYIpyAlefHXa-UdEE7Y",
  authDomain: "hcibs-sportsfiesta.firebaseapp.com",
  projectId: "hcibs-sportsfiesta",
  storageBucket: "hcibs-sportsfiesta.firebasestorage.app",
  messagingSenderId: "1059800316877",
  appId: "1:1059800316877:web:e5b4a29f8c53f36ca62284"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginBtn = document.getElementById("loginBtn");
const errorMsg = document.getElementById("errorMsg");

loginBtn.addEventListener("click", async () => {
  const email = emailInput.value;
  const password = passwordInput.value;
  errorMsg.classList.add("hidden");

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    window.location.href = "/login.html"; // placeholder
  } catch (err) {
    let message = "Login failed. Please try again.";
    switch (err.code) {
      case "auth/invalid-email":
        message = "Invalid email.";
        break;
      case "auth/user-not-found":
        message = "No account found with that email.";
        break;
      case "auth/wrong-password":
        message = "Incorrect password.";
        break;
      case "auth/too-many-requests":
        message = "Too many failed attempts. Try again later.";
        break;
    }
    errorMsg.innerText = message;
    errorMsg.classList.remove("hidden");
  }
});

function logoutUser() {
  signOut(auth)
    .then(() => {
      window.location.href = "/login.html";
    })
    .catch((error) => {
      console.error("Error signing out:", error);
    });
}

document.addEventListener('DOMContentLoaded', () => {
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
      e.preventDefault();
      logoutUser();
    });
  }
});

onAuthStateChanged(auth, (user) => {
  const btnDesktop = document.getElementById('login-menu-btn-desktop');
  const btnMobile = document.getElementById('login-menu-btn-mobile');

  if (user) {
    if (btnDesktop) {
      btnDesktop.textContent = 'My Dashboard';
      btnDesktop.href = '/dashboard.html';
    }
    if (btnMobile) {
      btnMobile.textContent = 'My Dashboard';
      btnMobile.href = '/dashboard.html';
    }
  } else {
    if (btnDesktop) {
      btnDesktop.textContent = 'Login';
      btnDesktop.href = '/login.html';
    }
    if (btnMobile) {
      btnMobile.textContent = 'Login';
      btnMobile.href = '/login.html';
    }
  }
});
