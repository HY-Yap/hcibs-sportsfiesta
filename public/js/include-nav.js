// public/js/include-nav.js
(async () => {
    try {
        const resp = await fetch("/nav.html", { cache: "no-store" });
        if (!resp.ok)
            throw new Error(`Failed to load nav.html (${resp.status})`);
        const html = await resp.text();

        const ph = document.getElementById("nav-placeholder");
        if (!ph) throw new Error("Missing #nav-placeholder in page.");
        ph.innerHTML = html;

        // Wire the mobile hamburger AFTER injection
        const toggleBtn = document.getElementById("menu-toggle");
        const menu = document.getElementById("menu");

        if (!toggleBtn || !menu) {
            console.warn("Nav injected but #menu-toggle or #menu not found.");
        } else {
            const toggleMenu = () => {
                const hidden = menu.classList.toggle("hidden");
                toggleBtn.setAttribute("aria-expanded", String(!hidden));
            };

            // Click + keyboard accessibility
            toggleBtn.addEventListener("click", toggleMenu);
            toggleBtn.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleMenu();
                }
            });

            // Close menu when a link is tapped (mobile UX)
            menu.querySelectorAll("a").forEach((a) => {
                a.addEventListener("click", () => {
                    if (!menu.classList.contains("hidden")) {
                        menu.classList.add("hidden");
                        toggleBtn.setAttribute("aria-expanded", "false");
                    }
                });
            });
        }

        // Let other scripts (auth.js) know nav is ready
        document.dispatchEvent(new Event("nav-loaded"));
    } catch (err) {
        console.error(err);
    }
})();
