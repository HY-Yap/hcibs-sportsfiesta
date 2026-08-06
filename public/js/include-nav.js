// public/js/include-nav.js
(async () => {
    try {
        if (!document.querySelector('link[data-sf-theme="true"]')) {
            const themeLink = document.createElement("link");
            themeLink.rel = "stylesheet";
            themeLink.href = "/css/theme.css";
            themeLink.dataset.sfTheme = "true";
            document.head.appendChild(themeLink);
        }

        const resp = await fetch("/nav.html", { cache: "no-store" });
        if (!resp.ok)
            throw new Error(`Failed to load nav.html (${resp.status})`);
        const html = await resp.text();

        const ph = document.getElementById("nav-placeholder");
        if (!ph) throw new Error("Missing #nav-placeholder in page.");
        ph.innerHTML = html;

        const currentPage =
            window.location.pathname.split("/").pop() || "index.html";
        ph.querySelectorAll("a[href]").forEach((link) => {
            const target = link.getAttribute("href");
            if (target === currentPage) link.setAttribute("aria-current", "page");
        });

        // Wire the mobile hamburger AFTER injection
        const toggleBtn = document.getElementById("menu-toggle");
        const menu = document.getElementById("menu");

        if (!toggleBtn || !menu) {
            console.warn("Nav injected but #menu-toggle or #menu not found.");
        } else {
            const toggleMenu = () => {
                const hidden = menu.classList.toggle("hidden");
                toggleBtn.setAttribute("aria-expanded", String(!hidden));
                toggleBtn.setAttribute(
                    "aria-label",
                    hidden ? "Open navigation menu" : "Close navigation menu"
                );
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
                        toggleBtn.setAttribute(
                            "aria-label",
                            "Open navigation menu"
                        );
                    }
                });
            });

            document.addEventListener("keydown", (event) => {
                if (event.key === "Escape" && !menu.classList.contains("hidden")) {
                    menu.classList.add("hidden");
                    toggleBtn.setAttribute("aria-expanded", "false");
                    toggleBtn.setAttribute(
                        "aria-label",
                        "Open navigation menu"
                    );
                    toggleBtn.focus();
                }
            });

            document.addEventListener("click", (event) => {
                const shell = document.querySelector(".sf-nav-shell");
                if (
                    shell &&
                    !shell.contains(event.target) &&
                    !menu.classList.contains("hidden")
                ) {
                    menu.classList.add("hidden");
                    toggleBtn.setAttribute("aria-expanded", "false");
                    toggleBtn.setAttribute(
                        "aria-label",
                        "Open navigation menu"
                    );
                }
            });

            window.addEventListener("resize", () => {
                if (window.innerWidth > 1024) {
                    menu.classList.add("hidden");
                    toggleBtn.setAttribute("aria-expanded", "false");
                    toggleBtn.setAttribute(
                        "aria-label",
                        "Open navigation menu"
                    );
                }
            });
        }

        // Let other scripts (auth.js) know nav is ready
        document.dispatchEvent(new Event("nav-loaded"));
    } catch (err) {
        console.error(err);
    }
})();
