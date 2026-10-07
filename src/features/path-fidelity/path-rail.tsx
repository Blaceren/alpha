"use client";

import { useEffect } from "react";
import { nearnessAt } from "@/features/path-fidelity/path-state";

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
 *   * `updateRailFades` — the more-left / more-right edge fades, the per-node
 *     `--peek` class for nodes clipped by the window, and the return-to-current
 *     utility whose visibility threshold is the current node's CENTRE leaving
 *     the window, with a directional arrow.
 *   * the return utility hands focus to the detail heading after use, so a
 *     keyboard user is never dropped to body.
 *   * `nearness` (DD-353) — how near the pointer is to each opened level's
 *     block, so the stylesheet can brighten that level's branch and run the
 *     light along its block's outline.
 *
 * The frozen leader that joined the current mark to the detail panel is gone
 * (DD-353, owner 2026-10-07: «она не должна входить в следующую область»), and
 * with it DD-346's single branch that moved to the pointed level and DD-352's
 * light along the panel's edge: each opened level has its own branch now, and
 * it ends in its own block.
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
    const workspace = root?.querySelector<HTMLElement>(".workspace");
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
    const strip = root.querySelector<HTMLElement>(".level-strip");

    /*
     * THE BLOCKS WAKE AS THE POINTER NEARS (DD-353, owner 2026-10-07: «она
     * должна в момент того как водишь и приближаешься к блоку становиться ярче
     * и начинать свечение обводки постепенно, блоки пройденные»). While a mouse
     * or a pen is over the module's field (`data-pointer` on it), every opened
     * level — walked, or the one in focus — gets `--near`: 1 inside its block,
     * fading to 0 at `NEAR_REACH` away. All reads come before all writes. When
     * the pointer leaves the field every block goes back to 0, and the
     * stylesheet lets the light out slowly. Keyboard focus on a level's way in
     * holds that level at 1. Touch has no hover, so a finger wakes nothing.
     */
    let pointer: { x: number; y: number } | null = null;
    let held: HTMLElement | null = null;

    function nearness() {
      const nodes = Array.from(root!.querySelectorAll<HTMLElement>(".level-node[data-open]"));
      const values = nodes.map((node) => {
        if (node === held) return 1;
        const block = node.querySelector<HTMLElement>(".level-node__block");
        if (!pointer || !block) return 0;
        const r = block.getBoundingClientRect();
        const dx = Math.max(r.left - pointer.x, 0, pointer.x - r.right);
        const dy = Math.max(r.top - pointer.y, 0, pointer.y - r.bottom);
        return nearnessAt(Math.hypot(dx, dy));
      });
      nodes.forEach((node, i) => node.style.setProperty("--near", values[i]!.toFixed(3)));
    }

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointer = { x: event.clientX, y: event.clientY };
      if (workspace) workspace.dataset.pointer = "";
      nearness();
    };
    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      pointer = null;
      if (workspace) delete workspace.dataset.pointer;
      nearness();
    };
    const openNodeAt = (target: EventTarget | null) => {
      const node = target instanceof Element ? target.closest<HTMLElement>(".level-node") : null;
      return node && node.hasAttribute("data-open") ? node : null;
    };
    const onFocusIn = (event: FocusEvent) => {
      held = openNodeAt(event.target);
      nearness();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (held && held.contains(event.relatedTarget as Node | null)) return;
      held = null;
      nearness();
    };

    function positionCurrent(smooth = false) {
      const cur = currentNode();
      if (!cur || !scroller) return;
      if (scroller.scrollWidth <= scroller.clientWidth) return;
      /* The level behind the current one is part of the view (DD-346): where
         the two fit side by side the strip opens on both; where they do not —
         a phone — the frozen landing, the current level at 42%. */
      const behind = cur.previousElementSibling as HTMLElement | null;
      const pairFits =
        behind !== null &&
        cur.offsetLeft + cur.offsetWidth - behind.offsetLeft <= scroller.clientWidth - 36;
      const left = pairFits
        ? behind.offsetLeft
        : cur.offsetLeft + cur.offsetWidth / 2 - scroller.clientWidth * 0.42;
      scroller.scrollTo({
        left,
        behavior: smooth && !prefersReduced() ? "smooth" : "instant",
      });
    }

    function updateRailFades() {
      if (!scroller || !rail) return;
      const max = scroller.scrollWidth - scroller.clientWidth;
      rail.classList.toggle("rail--more-left", scroller.scrollLeft > 4);
      rail.classList.toggle("rail--more-right", scroller.scrollLeft < max - 4);

      let currentVisible = true;
      const nodes = Array.from(root!.querySelectorAll<HTMLElement>(".level-node"));
      if (max <= 0) {
        /* Nothing pans (a desktop, or a window made wider): no level is cut. */
        for (const node of nodes) node.classList.remove("level-node--peek");
      } else {
        const s = scroller.getBoundingClientRect();
        for (const node of nodes) {
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

    /* A scroll moves the blocks under a still pointer; a resize moves them too. */
    const onResize = () => {
      positionCurrent();
      updateRailFades();
      if (pointer) nearness();
    };
    const onScroll = () => {
      updateRailFades();
      if (pointer) nearness();
    };
    const onPageScroll = () => {
      if (pointer) nearness();
    };

    positionCurrent();
    updateRailFades();

    returnBtn?.addEventListener("click", onReturn);
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onPageScroll, { passive: true });
    scroller.addEventListener("scroll", onScroll, { passive: true });
    workspace?.addEventListener("pointermove", onPointerMove);
    workspace?.addEventListener("pointerleave", onPointerLeave);
    strip?.addEventListener("focusin", onFocusIn);
    strip?.addEventListener("focusout", onFocusOut);

    return () => {
      returnBtn?.removeEventListener("click", onReturn);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onPageScroll);
      scroller.removeEventListener("scroll", onScroll);
      workspace?.removeEventListener("pointermove", onPointerMove);
      workspace?.removeEventListener("pointerleave", onPointerLeave);
      strip?.removeEventListener("focusin", onFocusIn);
      strip?.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return null;
}
