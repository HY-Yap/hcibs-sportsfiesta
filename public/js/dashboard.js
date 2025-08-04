import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { auth, db } from "./js/firebase-init.js";

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "index.html";
        return;
    }

    const userRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(userRef);
    const role = docSnap.exists() ? docSnap.data().role : "user";

    if (role === "admin") {
        alert("Admins are redirected to the Admin Panel.");
        window.location.href = "admin.html";
        return;
    }

});