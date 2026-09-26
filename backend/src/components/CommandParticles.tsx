"use client";

import { useEffect, useRef } from "react";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  tw: number;
  ph: number;
  blue: boolean;
  ox: number;
  oy: number;
};

/**
 * Data dust: редкая «рыночная пыль» на canvas — самый дальний план сцены.
 * Дрейфует медленно, мерцает, мягко расступается вокруг курсора.
 * Координаты мыши и параллакс читаются из CSS-переменных, которые уже
 * пишет CommandStageEffects — своих pointer-листенеров у слоя нет.
 * Выключено: prefers-reduced-motion, грубый указатель, <1024px.
 * Пауза: вкладка скрыта или hero вне вьюпорта.
 */
export function CommandParticles() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const stage = canvas?.closest<HTMLElement>(".command-stage");
    if (!canvas || !stage) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.matchMedia("(pointer: fine)").matches) return;
    if (!window.matchMedia("(min-width: 1024px)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let parts: Particle[] = [];
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let running = false;
    let tabVisible = true;
    let inView = true;
    let t = 0;

    let colors = { base: "148, 163, 189", blue: "47, 107, 255" };
    const parseHex = (value: string): string | null => {
      const s = value.trim();
      if (!/^#[0-9a-f]{6}$/i.test(s)) return null;
      const n = parseInt(s.slice(1), 16);
      return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
    };
    const readColors = () => {
      const cs = getComputedStyle(stage);
      colors = {
        base: parseHex(cs.getPropertyValue("--text-muted")) ?? colors.base,
        blue: parseHex(cs.getPropertyValue("--primary")) ?? colors.blue,
      };
    };

    const seed = () => {
      const count = Math.min(84, Math.round((w * h) / 15000));
      parts = Array.from({ length: count }, () => {
        const bright = Math.random() < 0.12;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.09,
          vy: (Math.random() - 0.5) * 0.06 - 0.01,
          r: bright ? 1.8 + Math.random() * 1.1 : 0.9 + Math.random() * 1.3,
          a: bright ? 0.5 + Math.random() * 0.25 : 0.2 + Math.random() * 0.3,
          tw: 0.2 + Math.random() * 0.55,
          ph: Math.random() * Math.PI * 2,
          blue: Math.random() < 0.3,
          ox: 0,
          oy: 0,
        };
      });
    };

    const resize = () => {
      const rect = stage.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = rect.width;
      h = rect.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      seed();
    };

    const readVar = (name: string) => {
      const value = parseFloat(stage.style.getPropertyValue(name));
      return Number.isFinite(value) ? value : 0;
    };

    const frame = () => {
      if (!tabVisible || !inView) {
        running = false;
        return;
      }
      t += 1 / 60;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const parX = readVar("--par-x") * -14;
      const parY = readVar("--par-y") * -11;
      const ma = readVar("--ma");
      const mx = (readVar("--mx") / 100) * w;
      const my = (readVar("--my") / 100) * h;

      for (const p of parts) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -4) p.x = w + 4;
        else if (p.x > w + 4) p.x = -4;
        if (p.y < -4) p.y = h + 4;
        else if (p.y > h + 4) p.y = -4;

        let tx = 0;
        let ty = 0;
        if (ma > 0.05) {
          const dx = p.x - mx;
          const dy = p.y - my;
          const d = Math.hypot(dx, dy);
          if (d < 170 && d > 0.001) {
            const f = (1 - d / 170) * 20 * ma;
            tx = (dx / d) * f;
            ty = (dy / d) * f;
          }
        }
        p.ox += (tx - p.ox) * 0.06;
        p.oy += (ty - p.oy) * 0.06;

        const alpha = p.a * (0.68 + 0.32 * Math.sin(t * p.tw + p.ph));
        ctx.beginPath();
        ctx.arc(p.x + parX + p.ox, p.y + parY + p.oy, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${p.blue ? colors.blue : colors.base}, ${alpha.toFixed(3)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(frame);
    };

    const ensureLoop = () => {
      if (!running && tabVisible && inView) {
        running = true;
        raf = requestAnimationFrame(frame);
      }
    };

    readColors();
    resize();
    ensureLoop();

    const ro = new ResizeObserver(() => resize());
    ro.observe(stage);

    const io = new IntersectionObserver((entries) => {
      inView = entries[0]?.isIntersecting ?? true;
      if (inView) ensureLoop();
    });
    io.observe(stage);

    const onVisibility = () => {
      tabVisible = document.visibilityState === "visible";
      if (tabVisible) ensureLoop();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const mo = new MutationObserver(readColors);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      mo.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={ref} className="stage-particles" aria-hidden="true" />;
}
