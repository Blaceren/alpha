"use client";

import { useEffect, useRef } from "react";

/**
 * Живой свет сцены: следует за курсором через CSS-переменные на .command-stage,
 * без React-state на mousemove. Параллакс-вары читают фон и зоны карты.
 * Отключается при prefers-reduced-motion и на устройствах без точного указателя.
 */
export function CommandStageEffects() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const layer = ref.current;
    const stage = layer?.closest<HTMLElement>(".command-stage");
    if (!layer || !stage) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;

    const idle = { x: 0.5, y: 0.32 };
    const target = { x: idle.x, y: idle.y, a: 0 };
    const cur = { x: idle.x, y: idle.y, a: 0 };
    let rect: DOMRect | null = null;
    let raf = 0;
    let running = false;

    // Магнитный свет кромок: позиция курсора относительно каждой зоны.
    const zones = Array.from(stage.querySelectorAll<HTMLElement>(".map-zone"));
    type ZoneRect = { left: number; top: number; right: number; bottom: number };
    let zoneRects: ZoneRect[] | null = null;

    const measureZones = (stageRect: DOMRect) => {
      zoneRects = zones.map((zone) => {
        const r = zone.getBoundingClientRect();
        return {
          left: r.left - stageRect.left,
          top: r.top - stageRect.top,
          right: r.right - stageRect.left,
          bottom: r.bottom - stageRect.top,
        };
      });
    };

    const tick = () => {
      cur.x += (target.x - cur.x) * 0.11;
      cur.y += (target.y - cur.y) * 0.11;
      cur.a += (target.a - cur.a) * 0.09;
      stage.style.setProperty("--mx", `${(cur.x * 100).toFixed(2)}%`);
      stage.style.setProperty("--my", `${(cur.y * 100).toFixed(2)}%`);
      stage.style.setProperty("--ma", cur.a.toFixed(3));
      stage.style.setProperty("--par-x", (cur.x - 0.5).toFixed(4));
      stage.style.setProperty("--par-y", (cur.y - 0.5).toFixed(4));

      if (!rect) rect = stage.getBoundingClientRect();
      if (!zoneRects) measureZones(rect);
      const px = cur.x * rect.width;
      const py = cur.y * rect.height;
      zones.forEach((zone, index) => {
        const zr = zoneRects![index];
        const nx = Math.max(zr.left, Math.min(px, zr.right));
        const ny = Math.max(zr.top, Math.min(py, zr.bottom));
        const dist = Math.hypot(px - nx, py - ny);
        const za = Math.max(0, 1 - dist / 110);
        zone.style.setProperty("--zx", `${(px - zr.left).toFixed(1)}px`);
        zone.style.setProperty("--zy", `${(py - zr.top).toFixed(1)}px`);
        zone.style.setProperty("--za", za.toFixed(3));
      });

      const settled =
        Math.abs(target.x - cur.x) < 0.001 &&
        Math.abs(target.y - cur.y) < 0.001 &&
        Math.abs(target.a - cur.a) < 0.003;
      if (settled && target.a === 0) {
        running = false;
        return;
      }
      raf = requestAnimationFrame(tick);
    };

    const ensureLoop = () => {
      if (!running) {
        running = true;
        raf = requestAnimationFrame(tick);
      }
    };

    const invalidateRect = () => {
      rect = null;
      zoneRects = null;
    };

    // Зоны заканчивают входную анимацию ~за секунду — перемеряем их после неё.
    const remeasureTimer = window.setTimeout(invalidateRect, 1500);

    const onMove = (event: PointerEvent) => {
      if (!rect) rect = stage.getBoundingClientRect();
      target.x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      target.y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      target.a = 1;
      ensureLoop();
    };

    const onLeave = () => {
      target.x = idle.x;
      target.y = idle.y;
      target.a = 0;
      ensureLoop();
    };

    stage.addEventListener("pointermove", onMove, { passive: true });
    stage.addEventListener("pointerleave", onLeave);
    window.addEventListener("resize", invalidateRect, { passive: true });
    window.addEventListener("scroll", invalidateRect, { passive: true });

    return () => {
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
      window.removeEventListener("resize", invalidateRect);
      window.removeEventListener("scroll", invalidateRect);
      window.clearTimeout(remeasureTimer);
      cancelAnimationFrame(raf);
      ["--mx", "--my", "--ma", "--par-x", "--par-y"].forEach((name) => {
        stage.style.removeProperty(name);
      });
      zones.forEach((zone) => {
        ["--zx", "--zy", "--za"].forEach((name) => zone.style.removeProperty(name));
      });
    };
  }, []);

  return <div ref={ref} className="stage-pointer-glow" aria-hidden="true" />;
}
