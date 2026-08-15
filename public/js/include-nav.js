// public/js/include-nav.js
// Keep the last confirmed auth state locally so page-to-page navigation can
// paint the correct account controls before Firebase finishes restoring its
// persisted session.
(() => {
    if (window.SportsFiestaAuthUI) return;

    const storageKey = "sportsFiesta.authUI.v1";
    const validRoles = new Set(["admin", "scorekeeper", "player", "user"]);

    const normaliseRole = (role) =>
        validRoles.has(role) ? role : "user";

    const read = () => {
        try {
            const state = JSON.parse(localStorage.getItem(storageKey));
            if (
                state?.status !== "authenticated" &&
                state?.status !== "unauthenticated"
            ) {
                return null;
            }
            if (state.status === "authenticated") {
                return {
                    status: "authenticated",
                    uid: typeof state.uid === "string" ? state.uid : "",
                    role: normaliseRole(state.role),
                };
            }
            return { status: "unauthenticated" };
        } catch {
            return null;
        }
    };

    const write = (state) => {
        const safeState =
            state?.status === "authenticated"
                ? {
                      status: "authenticated",
                      uid: typeof state.uid === "string" ? state.uid : "",
                      role: normaliseRole(state.role),
                  }
                : { status: "unauthenticated" };
        try {
            localStorage.setItem(storageKey, JSON.stringify(safeState));
        } catch {
            // The UI still works when storage is unavailable (for example, in
            // privacy-restricted browser contexts); it just cannot fast-paint.
        }
        return safeState;
    };

    const dashboardLabel = (role) => {
        if (role === "admin") return "Admin Dashboard";
        if (role === "scorekeeper") return "Scorekeeper Dashboard";
        return "My Dashboard";
    };

    const renderNav = (root, state) => {
        if (!root) return;
        const authLinks = root.querySelectorAll(".auth-menu-btn");
        const logoutLinks = root.querySelectorAll(".logout-btn");

        if (state?.status === "authenticated") {
            authLinks.forEach((link) => {
                link.textContent = dashboardLabel(state.role);
                link.classList.remove("hidden");
            });
            logoutLinks.forEach((link) => link.classList.remove("hidden"));
            return;
        }

        if (state?.status === "unauthenticated") {
            authLinks.forEach((link) => {
                link.textContent = "Login";
                link.classList.remove("hidden");
            });
            logoutLinks.forEach((link) => link.classList.add("hidden"));
            return;
        }

        // On a browser's first visit, do not flash an incorrect Login button
        // while Firebase is still determining the real session state.
        authLinks.forEach((link) => link.classList.add("hidden"));
        logoutLinks.forEach((link) => link.classList.add("hidden"));
    };

    const renderDashboard = (root, state) => {
        if (!root || state?.status !== "authenticated") return;

        const role = normaliseRole(state.role);
        const sidebarNav = root.querySelector("#sidebar-nav");
        if (!sidebarNav) return;

        let title = "User Dashboard";
        if (role === "admin") title = "Admin Dashboard";
        else if (role === "scorekeeper") title = "Scorekeeper Dashboard";

        const sidebarTitle = root.querySelector("#sidebar-title");
        const dashboardTitle = root.querySelector("#dashboard-title");
        if (sidebarTitle) sidebarTitle.textContent = title;
        if (dashboardTitle) dashboardTitle.textContent = title;

        const linkClass =
            "block py-2 px-3 rounded hover:bg-accent/20 hover:text-accent font-semibold transition";
        const links = [
            ["dashboard.html", "profile-link", "My Profile"],
        ];
        if (role === "player") {
            links.push(
                ["mymatches.html", "matches-link", "My Matches"],
                ["mystats.html", "stats-link", "My Stats"]
            );
        }
        if (role === "scorekeeper" || role === "admin") {
            links.push([
                "scorekeeper.html",
                "edit-matches-link",
                "Edit Matches",
            ]);
        }
        if (role === "admin") {
            links.push([
                "controls.html",
                "admin-controls-link",
                "Admin Controls",
            ]);
        }

        sidebarNav.replaceChildren(
            ...links.map(([href, id, label]) => {
                const link = document.createElement("a");
                link.href = href;
                link.id = id;
                link.className = linkClass;
                link.textContent = label;
                return link;
            })
        );
    };

    window.SportsFiestaAuthUI = {
        dashboardLabel,
        normaliseRole,
        read,
        renderDashboard,
        renderNav,
        write,
    };
})();

// Dashboard pages already contain their sidebar markup when this classic
// script runs. Paint it synchronously, before any remote module imports.
window.SportsFiestaAuthUI.renderDashboard(
    document,
    window.SportsFiestaAuthUI.read()
);

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
        const navTemplate = document.createElement("template");
        navTemplate.innerHTML = html;
        window.SportsFiestaAuthUI.renderNav(
            navTemplate.content,
            window.SportsFiestaAuthUI.read()
        );
        ph.replaceChildren(navTemplate.content.cloneNode(true));

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
