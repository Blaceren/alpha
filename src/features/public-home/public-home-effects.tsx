"use client";

import { useEffect } from "react";

/**
 * Public Home interaction controller — the non-menu half of HomeATA's script.js.
 *
 * It renders nothing. It reproduces, exactly, the four document-level behaviours
 * the frozen page has, and nothing more:
 *
 *   1. `has-js` on the page root, which is what switches the reveal animation on.
 *      In HomeATA this went on documentElement; here it goes on the Public Home
 *      root, because a global marker would be visible to every other route.
 *
 *   2. `ph-smooth-scroll` on documentElement. Anchor scrolling is a property of
 *      the real root scroller, so this is the one place the root is touched. It
 *      is a ph-prefixed class, it is added on mount and REMOVED on unmount, and
 *      the only rule keyed on it lives in public-home.css — so no other route
 *      can ever see its effect.
 *
 *   3. The compact-header class toggle on scroll past 32px.
 *      NOTE, DELIBERATELY PRESERVED AS-IS: the frozen stylesheet contains no
 *      rule for `.is-compact`, so this toggle has no visual effect in HomeATA
 *      either. It is reproduced because the behaviour is part of the frozen
 *      page; inventing a compact-header style here would be designing, which
 *      this phase is explicitly not authorised to do.
 *
 *   4. The reveal observer: threshold 0.08, rootMargin "0px 0px -3%", adds
 *      `is-visible` once and unobserves. Without IntersectionObserver every
 *      element is revealed immediately — content must never stay hidden.
 *
 * The `data-frame-stage` branch of script.js is NOT reproduced, because the
 * frozen HTML contains no such element: that branch is inert in HomeATA and
 * adding an element to make it fire would change the page.
 */
export function PublicHomeEffects() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-ph-root]");
    const header = document.querySelector<HTMLElement>("[data-header]");

    root?.classList.add("has-js");
    document.documentElement.classList.add("ph-smooth-scroll");

    const updateHeader = () => {
      header?.classList.toggle("is-compact", window.scrollY > 32);
    };
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });

    const revealElements =
      document.querySelectorAll<HTMLElement>("[data-reveal]");
    let observer: IntersectionObserver | null = null;

    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries, obs) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add("is-visible");
            obs.unobserve(entry.target);
          });
        },
        { threshold: 0.08, rootMargin: "0px 0px -3%" },
      );
      revealElements.forEach((element) => observer?.observe(element));
    } else {
      revealElements.forEach((element) => element.classList.add("is-visible"));
    }

    return () => {
      window.removeEventListener("scroll", updateHeader);
      observer?.disconnect();
      // Leave the document exactly as it was found.
      document.documentElement.classList.remove("ph-smooth-scroll");
      root?.classList.remove("has-js");
    };
  }, []);

  return null;
}
