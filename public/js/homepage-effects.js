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

  const clamp = (value, min = 0, max = 1) =>
    Math.min(max, Math.max(min, value));

  const renderScrollMotion = () => {
    frameRequested = false;
    const navShell = document.querySelector(".sf-nav-shell");
    navShell?.classList.toggle("is-scrolled", window.scrollY > 26);

    if (!hero || reduceMotion.matches || sportObjects.length === 0) return;

    const heroTop = hero.getBoundingClientRect().top + window.scrollY;
    const travel = Math.max(hero.offsetHeight * 0.82, 520);
    const progress = clamp((window.scrollY - heroTop + 30) / travel);
    const compactFactor =
      window.innerWidth <= 640 ? 0.34 : window.innerWidth <= 820 ? 0.58 : 1;
    const exitProgress = clamp((progress - 0.78) / 0.22);

    sportObjects.forEach((object) => {
      const config = motion[object.dataset.sportObject];
      if (!config) return;

      const objectFactor =
        window.innerWidth <= 640 && object.dataset.sportObject === "frisbee"
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

    hero.style.setProperty("--hero-pointer-x", `${normalizedX * 100 + 50}%`);
    hero.style.setProperty("--hero-pointer-y", `${normalizedY * 100 + 50}%`);

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
  const counters = Array.from(document.querySelectorAll(".sf-stat-value"));
  const animatedCounters = new WeakSet();
  let numbersAreVisible = false;

  const animateCounter = (counter) => {
    if (!numbersAreVisible || animatedCounters.has(counter)) return;

    const target = Number.parseInt(counter.textContent.trim(), 10);
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

  const animateAvailableCounters = () => counters.forEach(animateCounter);

  counters.forEach((counter) => {
    const valueObserver = new MutationObserver(() => animateCounter(counter));
    valueObserver.observe(counter, { childList: true, characterData: true });
  });

  const initialScrollPosition = window.scrollY;
  const activateCountersOnScroll = () => {
    if (!numberSection || numbersAreVisible) return;

    const hasActuallyScrolled =
      Math.abs(window.scrollY - initialScrollPosition) >= 40;
    const sectionBounds = numberSection.getBoundingClientRect();
    const hasReachedSection =
      sectionBounds.top <= window.innerHeight * 0.68 &&
      sectionBounds.bottom >= window.innerHeight * 0.2;

    if (!hasActuallyScrolled || !hasReachedSection) return;

    numbersAreVisible = true;
    animateAvailableCounters();
    window.removeEventListener("scroll", activateCountersOnScroll);
  };

  window.addEventListener("scroll", activateCountersOnScroll, {
    passive: true,
  });

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
