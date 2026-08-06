(() => {
    const hero = document.querySelector(".sf-hero");
    const sportObjects = Array.from(
        document.querySelectorAll("[data-sport-object]"),
    );
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    const motion = {
        basketball: { x: 280, y: 650, rotation: 250 },
        volleyball: { x: -260, y: 590, rotation: -165 },
        frisbee: { x: -520, y: 440, rotation: -18 },
        badminton: { x: 420, y: 430, rotation: -30 },
    };

    const pointerDepth = {
        basketball: 9,
        volleyball: -7,
        frisbee: -11,
        badminton: 8,
    };

    let frameRequested = false;
    let renderNumberScenes = () => {};

    const clamp = (value, min = 0, max = 1) =>
        Math.min(max, Math.max(min, value));

    const renderScrollMotion = () => {
        frameRequested = false;
        const navShell = document.querySelector(".sf-nav-shell");
        navShell?.classList.toggle("is-scrolled", window.scrollY > 26);
        renderNumberScenes();

        if (!hero || reduceMotion.matches || sportObjects.length === 0) return;

        const heroTop = hero.getBoundingClientRect().top + window.scrollY;
        const travel = Math.max(hero.offsetHeight * 0.82, 520);
        const progress = clamp((window.scrollY - heroTop + 30) / travel);
        const compactFactor =
            window.innerWidth <= 640
                ? 0.34
                : window.innerWidth <= 820
                  ? 0.58
                  : 1;
        const exitProgress = clamp((progress - 0.78) / 0.22);

        sportObjects.forEach((object) => {
            const config = motion[object.dataset.sportObject];
            if (!config) return;

            const objectFactor =
                window.innerWidth <= 640 &&
                object.dataset.sportObject === "frisbee"
                    ? 0.28
                    : compactFactor;

            const eased = 1 - Math.pow(1 - progress, 3);
            object.style.setProperty(
                "--move-x",
                `${config.x * eased * objectFactor}px`,
            );
            object.style.setProperty(
                "--move-y",
                `${config.y * eased * objectFactor}px`,
            );
            object.style.setProperty("--spin", `${config.rotation * eased}deg`);
            object.style.opacity = String(1 - exitProgress);
        });
    };

    const requestRender = () => {
        if (frameRequested) return;
        frameRequested = true;
        window.requestAnimationFrame(renderScrollMotion);
    };

    const setHeroPointer = (event) => {
        if (!hero || reduceMotion.matches) return;

        const bounds = hero.getBoundingClientRect();
        const normalizedX = (event.clientX - bounds.left) / bounds.width - 0.5;
        const normalizedY = (event.clientY - bounds.top) / bounds.height - 0.5;

        hero.style.setProperty(
            "--hero-pointer-x",
            `${normalizedX * 100 + 50}%`,
        );
        hero.style.setProperty(
            "--hero-pointer-y",
            `${normalizedY * 100 + 50}%`,
        );

        sportObjects.forEach((object) => {
            const depth = pointerDepth[object.dataset.sportObject] || 0;
            object.style.setProperty("--pointer-x", `${normalizedX * depth}px`);
            object.style.setProperty("--pointer-y", `${normalizedY * depth}px`);
        });
    };

    const resetHeroPointer = () => {
        sportObjects.forEach((object) => {
            object.style.setProperty("--pointer-x", "0px");
            object.style.setProperty("--pointer-y", "0px");
        });
    };

    const revealTargets = document.querySelectorAll(".sf-reveal");
    if ("IntersectionObserver" in window && !reduceMotion.matches) {
        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add("is-visible");
                        observer.unobserve(entry.target);
                    }
                });
            },
            { threshold: 0.16 },
        );
        revealTargets.forEach((target) => observer.observe(target));
    } else {
        revealTargets.forEach((target) => target.classList.add("is-visible"));
    }

    const numberSection = document.querySelector(".sf-numbers");
    const numberScenes = Array.from(
        document.querySelectorAll("[data-number-scene]"),
    );
    const stageProgress = document.querySelector(".sf-stage-progress");
    const progressLabel = stageProgress?.querySelector("[data-progress-label]");
    const progressLabelOld = stageProgress?.querySelector(
        "[data-progress-label-old]",
    );
    const progressEnd = stageProgress?.querySelector("[data-progress-end]");
    const progressEndOld = stageProgress?.querySelector(
        "[data-progress-end-old]",
    );
    const counters = Array.from(document.querySelectorAll(".sf-stat-value"));
    const animatedCounters = new WeakSet();
    const counterTargets = new WeakMap();
    const resettingCounters = new WeakSet();

    if (numberSection && numberScenes.length) {
        document.documentElement.classList.add("sf-scroll-scenes-ready");
    }

    const progressStates = [
        null,
        { label: "01 · BADMINTON", end: "04 SPORTS", color: "#7eb6cf" },
        { label: "02 · BASKETBALL", end: "04 SPORTS", color: "#f59d19" },
        { label: "03 · FRISBEE", end: "04 SPORTS", color: "#52afa5" },
        { label: "04 · VOLLEYBALL", end: "04 SPORTS", color: "#f35b50" },
        { label: "TOTAL · MATCHES", end: "FINAL", color: "#f2cc4d" },
    ];
    let currentProgressState = 1;

    const morphProgress = (nextStateIndex) => {
        if (!stageProgress || nextStateIndex === currentProgressState) return;

        const nextState = progressStates[nextStateIndex];
        if (!nextState) return;

        if (progressLabel && progressLabelOld) {
            progressLabelOld.textContent = progressLabel.textContent;
            progressLabel.textContent = nextState.label;
        }
        if (progressEnd && progressEndOld) {
            progressEndOld.textContent = progressEnd.textContent;
            progressEnd.textContent = nextState.end;
        }

        stageProgress.style.setProperty("--progress-color", nextState.color);
        stageProgress.classList.remove("is-morphing");
        void stageProgress.offsetWidth;
        stageProgress.classList.add("is-morphing");
        currentProgressState = nextStateIndex;
    };

    const animateCounter = (counter) => {
        const scene = counter.closest("[data-number-scene]");
        if (!scene?.classList.contains("is-focused")) return;
        if (animatedCounters.has(counter)) return;

        const target = counterTargets.get(counter);
        if (!Number.isFinite(target)) return;

        animatedCounters.add(counter);
        if (reduceMotion.matches || target <= 0) {
            counter.textContent = String(target);
            return;
        }

        const duration = Math.min(2500, 1440 + target * 20);
        const startedAt = performance.now();
        counter.classList.add("is-counting");
        counter.textContent = "0";

        const tick = (now) => {
            const progress = clamp((now - startedAt) / duration);
            const eased = 1 - Math.pow(1 - progress, 4);
            counter.textContent = String(Math.round(target * eased));

            if (progress < 1) {
                window.requestAnimationFrame(tick);
            } else {
                counter.textContent = String(target);
                counter.classList.remove("is-counting");
            }
        };

        window.requestAnimationFrame(tick);
    };

    counters.forEach((counter) => {
        const initialTarget = Number.parseInt(counter.textContent.trim(), 10);
        if (Number.isFinite(initialTarget)) {
            counterTargets.set(counter, initialTarget);
        }
        counter.textContent = "0";

        const valueObserver = new MutationObserver(() => {
            if (animatedCounters.has(counter)) return;
            if (resettingCounters.has(counter)) {
                resettingCounters.delete(counter);
                return;
            }

            const target = Number.parseInt(counter.textContent.trim(), 10);
            if (!Number.isFinite(target)) {
                resettingCounters.add(counter);
                counter.textContent = "0";
                return;
            }

            counterTargets.set(counter, target);
            if (
                counter
                    .closest("[data-number-scene]")
                    ?.classList.contains("is-focused")
            ) {
                animateCounter(counter);
            } else if (counter.textContent !== "0") {
                resettingCounters.add(counter);
                counter.textContent = "0";
            }
        });
        valueObserver.observe(counter, {
            childList: true,
            characterData: true,
        });
    });

    renderNumberScenes = () => {
        if (!numberSection || numberScenes.length === 0) return;

        const sectionBounds = numberSection.getBoundingClientRect();
        if (sectionBounds.top <= window.innerHeight * 0.5) {
            numberSection.classList.add("has-entered");
        }
        const scrollRange = Math.max(
            numberSection.offsetHeight - window.innerHeight,
            1,
        );
        const sceneProgress =
            clamp(-sectionBounds.top / scrollRange) * (numberScenes.length - 1);
        const nextActiveIndex = Math.round(sceneProgress);

        if (stageProgress) {
            const revealProgress = clamp((sceneProgress - 0.55) / 0.2);
            const progressOpacity = reduceMotion.matches
                ? Number(sceneProgress >= 0.75)
                : revealProgress * revealProgress * (3 - 2 * revealProgress);
            const sportProgress = clamp(sceneProgress, 1, 4);
            const progressStateIndex = Math.max(1, nextActiveIndex);

            stageProgress.style.setProperty(
                "--progress-opacity",
                String(progressOpacity),
            );
            stageProgress.style.setProperty(
                "--progress-fill",
                `${sportProgress * 25}%`,
            );
            morphProgress(progressStateIndex);
        }

        numberScenes.forEach((scene, index) => {
            const distance = index - sceneProgress;
            const absoluteDistance = Math.abs(distance);
            const swipeProgress = clamp((absoluteDistance - 0.4) / 0.2);
            const easedSwipe =
                swipeProgress * swipeProgress * (3 - 2 * swipeProgress);
            const opacity = reduceMotion.matches
                ? Number(index === nextActiveIndex)
                : 1 - easedSwipe;
            const isActive = index === nextActiveIndex;
            const isFocused = isActive && opacity >= 0.98;
            const verticalTravel = Math.min(window.innerHeight * 0.28, 240);

            scene.classList.toggle("is-active", isActive);
            scene.classList.toggle("is-focused", isFocused);
            scene.style.setProperty("--scene-opacity", String(opacity));
            scene.style.setProperty(
                "--scene-y",
                reduceMotion.matches
                    ? "0px"
                    : `${Math.sign(distance) * easedSwipe * verticalTravel}px`,
            );
            scene.style.setProperty("--scene-scale", "1");
            scene.style.setProperty("--scene-blur", "0px");
        });

        const counter =
            numberScenes[nextActiveIndex]?.querySelector(".sf-stat-value");
        if (counter) animateCounter(counter);
    };

    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    if (finePointer.matches && hero) {
        hero.addEventListener("pointermove", setHeroPointer, { passive: true });
        hero.addEventListener("pointerleave", resetHeroPointer);

        document.querySelectorAll(".sf-stat-card").forEach((card) => {
            card.addEventListener("pointermove", (event) => {
                const bounds = card.getBoundingClientRect();
                const x = (event.clientX - bounds.left) / bounds.width - 0.5;
                const y = (event.clientY - bounds.top) / bounds.height - 0.5;
                card.style.setProperty("--card-rx", `${y * -5}deg`);
                card.style.setProperty("--card-ry", `${x * 5}deg`);
            });
            card.addEventListener("pointerleave", () => {
                card.style.setProperty("--card-rx", "0deg");
                card.style.setProperty("--card-ry", "0deg");
            });
        });
    }

    window.addEventListener("scroll", requestRender, { passive: true });
    window.addEventListener("resize", requestRender);
    reduceMotion.addEventListener?.("change", requestRender);
    requestRender();
})();
