"use client";

import { useEffect } from "react";

/**
 * Path rail controller — the frozen surface's geometry behaviour.
 *
 * The frozen prototype's script does two separable things: it renders fixtures,
 * and it manages the rail's geometry. Only the second belongs in the product —
 * the first is replaced by real curriculum data rendered on the server.
 *
 * What is reproduced here, and nothing else:
 *
 *   * `positionCurrent` — bring the current node to 42% of the rail width, the
 *     frozen landing position. Instant on load, and instant under reduced
 *     motion.
 *   * `layoutFocusJoin` — the leader line that visually joins the current node's
 *     mark to the focus panel, including the merged case when the node sits at
 *     the panel's left edge and the hidden case when it is past the right edge.
 *   * `updateRailFades` — the more-left / more-right edge fades, the per-node
 *     `--peek` class for nodes clipped by the window, and the return-to-current
 *     utility whose visibility threshold is the current node's CENTRE leaving
 *     the window, with a directional arrow.
 *   * the return utility hands focus to the detail heading after use, so a
 *     keyboard user is never dropped to body.
 *
 * The frozen script's transition engine (workflow / advance / module swaps) is
 * deliberately NOT reproduced. Those are driven by its synthetic transition
 * harness; in the product a state change is a navigation, and the server renders
 * the new state. Reproducing them would mean simulating progression on the
 * client, which is exactly the authority inversion the contracts forbid.
 */
export function PathRail() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>("[data-pth-root]");
    const scroller = root?.querySelector<HTMLElement>("[data-scroller]");
    const rail = root?.querySelector<HTMLElement>(".rail");
    const leader = root?.querySelector<HTMLElement>("[data-leader]");
    const returnBtn = root?.querySelector<HTMLButtonElement>("[data-return]");
    if (!root || !scroller || !rail) return;

    /* matchMedia guard (jsdom-safe), as elsewhere in the product. The frozen
       script could assume a browser; this controller also mounts under the test
       environment, and a missing matchMedia must degrade to "no stated
       preference" rather than throw and take the surface down. */
    const reducedQuery =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    const prefersReduced = () => reducedQuery?.matches ?? false;
    const currentNode = () => root.querySelector<HTMLElement>('[aria-current="step"]');

    function positionCurrent(smooth = false) {
      const cur = currentNode();
      if (!cur || !scroller) return;
      if (scroller.scrollWidth <= scroller.clientWidth) return;
      const left = cur.offsetLeft + cur.offsetWidth / 2 - scroller.clientWidth * 0.42;
      scroller.scrollTo({
        left,
        behavior: smooth && !prefersReduced() ? "smooth" : "instant",
      });
    }

    function layoutFocusJoin() {
      const cur = currentNode();
      const focus = root?.querySelector<HTMLElement>("[data-focus]");
      if (!cur || !focus || !leader) return;
      const mark = cur.querySelector<HTMLElement>(".level-node__mark");
      if (!mark) return;
      const markRect = mark.getBoundingClientRect();
      const focusRect = focus.getBoundingClientRect();
      const x = markRect.left + markRect.width / 2 - focusRect.left;
      if (x <= 30) {
        leader.classList.add("focus__leader--merged");
        leader.style.left = "-1px";
        leader.hidden = false;
      } else if (x < focusRect.width - 30) {
        leader.classList.remove("focus__leader--merged");
        leader.style.left = `${Math.round(x)}px`;
        leader.hidden = false;
      } else {
        leader.hidden = true;
      }
    }

    function updateRailFades() {
      if (!scroller || !rail) return;
      const max = scroller.scrollWidth - scroller.clientWidth;
      rail.classList.toggle("rail--more-left", scroller.scrollLeft > 4);
      rail.classList.toggle("rail--more-right", scroller.scrollLeft < max - 4);

      let currentVisible = true;
      if (max > 0) {
        const s = scroller.getBoundingClientRect();
        for (const node of Array.from(root!.querySelectorAll<HTMLElement>(".level-node"))) {
          const r = node.getBoundingClientRect();
          node.classList.toggle("level-node--peek", r.left < s.left + 10 || r.right > s.right - 10);
        }
        const cur = currentNode();
        if (cur) {
          const r = cur.getBoundingClientRect();
          const cx = (r.left + r.right) / 2;
          currentVisible = cx > s.left + 8 && cx < s.right - 8;
        }
      }

      if (returnBtn) {
        returnBtn.hidden = currentVisible;
        if (!currentVisible) {
          const cur = currentNode();
          if (cur) {
            const s2 = scroller.getBoundingClientRect();
            const r = cur.getBoundingClientRect();
            const cx = (r.left + r.right) / 2;
            returnBtn.textContent =
              cx < (s2.left + s2.right) / 2 ? "← К текущему уровню" : "К текущему уровню →";
          }
        }
      }
    }

    const onReturn = () => {
      positionCurrent(true);
      window.setTimeout(
        () => root.querySelector<HTMLElement>("[data-detail-title]")?.focus({ preventScroll: true }),
        prefersReduced() ? 0 : 380,
      );
    };

    const onResize = () => {
      positionCurrent();
      layoutFocusJoin();
      updateRailFades();
    };
    const onScroll = () => {
      layoutFocusJoin();
      updateRailFades();
    };

    positionCurrent();
    layoutFocusJoin();
    updateRailFades();

    returnBtn?.addEventListener("click", onReturn);
    window.addEventListener("resize", onResize);
    scroller.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      returnBtn?.removeEventListener("click", onReturn);
      window.removeEventListener("resize", onResize);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, []);

  return null;
}
