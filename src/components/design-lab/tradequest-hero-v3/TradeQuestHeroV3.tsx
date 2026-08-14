"use client";

import { labDisplayV3 } from "../lab-display-font";
import Link from "next/link";
import { useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import styles from "./tradequest-hero-v3.module.css";


if (typeof window !== "undefined") gsap.registerPlugin(useGSAP, ScrollTrigger);

type Variant = "a" | "b" | "c";

const variants: Array<{ id: Variant; code: string; name: string; note: string }> = [
  { id: "a", code: "A", name: "Монолит", note: "Камера приближается к активному шагу" },
  { id: "b", code: "B", name: "Система", note: "Интерфейс раскрывается по слоям" },
  { id: "c", code: "C", name: "Коридор", note: "Камера проходит сквозь product surface" },
];

const steps = [
  ["01", "Диагностика", "done"],
  ["02", "Уроки", "done"],
  ["03", "Практика", "active"],
  ["04", "Наставник", "next"],
  ["05", "Pocket", "next"],
  ["06", "Прогресс", "goal"],
] as const;

function SignalGraph() {
  return (
    <svg className={styles.graph} viewBox="0 0 880 280" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id="hero-v3-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".24" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className={styles.graphGrid} d="M0 56H880M0 112H880M0 168H880M0 224H880" />
      <path className={styles.graphArea} fill="url(#hero-v3-fill)" d="M0 238C70 230 90 188 150 196s82-54 150-38 88-68 154-40 88-54 152-36 92-72 164-42 100-62 160-52V280H0Z" />
      <path className={styles.graphLine} d="M0 238C70 230 90 188 150 196s82-54 150-38 88-68 154-40 88-54 152-36 92-72 164-42 100-62 160-52" />
    </svg>
  );
}

function ProductDashboard() {
  return (
    <div className={styles.productRig} data-product-rig>
      <div className={styles.shadowPlane} data-depth-plane="back" aria-hidden="true" />
      <div className={styles.shadowPlane} data-depth-plane="mid" aria-hidden="true" />
      <article className={styles.productObject} data-product-object>
        <header className={styles.productHeader}>
          <div>
            <span>ALPHA ACADEMY / SYSTEM 03</span>
            <strong>Панель прогресса</strong>
          </div>
          <div className={styles.productLevel}>
            <span>УРОВЕНЬ</span>
            <b>7 / 16</b>
          </div>
        </header>

        <div className={styles.productGraph} data-system-layer="signal">
          <div className={styles.graphLabel}>
            <span>СИГНАЛ ПРОГРЕССА</span>
            <b>Система удерживает курс</b>
          </div>
          <SignalGraph />
        </div>

        <ol className={styles.productSteps} data-system-layer="path">
          {steps.map(([number, label, state]) => (
            <li key={number} data-state={state}>
              <i>{state === "done" ? "✓" : number}</i>
              <span>{label}</span>
              {state === "active" ? <small>ВЫ ЗДЕСЬ</small> : null}
            </li>
          ))}
        </ol>

        <div className={styles.productStatus} data-system-layer="status">
          <div><span>АКТИВНЫЙ ЭТАП</span><b>03 Практика</b></div>
          <div><span>ОТЧЁТ</span><b>Проверяется наставником</b></div>
          <div><span>POCKET CHECKPOINT</span><b data-positive>Готово</b></div>
        </div>

        <footer className={styles.productFooter} data-system-layer="progress">
          <span>XP ПРОГРЕСС</span>
          <div><i /></div>
          <b>420 / 700</b>
        </footer>
      </article>

      <div className={styles.hudHud} data-hud="step"><span>03</span><b>Активный узел</b></div>
      <div className={styles.hudHud} data-hud="mentor"><span>04</span><b>Отчёт принят</b></div>
      <div className={styles.hudHud} data-hud="checkpoint"><span>05</span><b>Checkpoint готов</b></div>
    </div>
  );
}

function TransitionRail({ variant }: { variant: Variant }) {
  const title = variant === "a" ? "Один объект. Один маршрут." : variant === "b" ? "Система раскрывается изнутри." : "Курс задаёт активный узел.";
  return (
    <div className={styles.transitionScene} data-transition-scene>
      <div className={styles.transitionHeading}>
        <span>СЛЕДУЮЩАЯ СЦЕНА / 01—06</span>
        <h2>{title}</h2>
      </div>
      <ol className={styles.transitionRail} data-transition-rail>
        {steps.map(([number, label, state]) => (
          <li key={number} data-state={state}>
            <i>{number}</i><strong>{label}</strong><span>{state === "active" ? "ВЫ ЗДЕСЬ" : state === "done" ? "ГОТОВО" : "ДАЛЕЕ"}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function TradeQuestHeroV3() {
  const root = useRef<HTMLDivElement>(null);
  const [variant, setVariant] = useState<Variant>("a");

  useGSAP(() => {
    const scope = root.current;
    if (!scope) return;

    const mm = gsap.matchMedia();
    mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
      const timeline = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: "[data-hero-pin]",
          start: "top 64px",
          end: () => `+=${Math.round(window.innerHeight * 1.75)}`,
          pin: "[data-hero-stage]",
          scrub: 0.55,
          invalidateOnRefresh: true,
          anticipatePin: 1,
        },
      });

      timeline
        .to("[data-hero-copy]", { autoAlpha: 0, yPercent: -28, scale: 0.94 }, 0.08)
        .to("[data-variant-nav]", { autoAlpha: 0.28, y: -12 }, 0.1)
        .to("[data-hud]", { autoAlpha: 1, stagger: 0.05 }, 0.12);

      if (variant === "a") {
        timeline
          .to("[data-product-rig]", { xPercent: -16, yPercent: -2, scale: 1.2, rotationX: 0, rotationY: 0 }, 0.12)
          .to("[data-product-object]", { boxShadow: "0 70px 150px rgba(0,0,0,.72)" }, 0.18)
          .to("[data-system-layer='path']", { y: 250, scale: 1.04 }, 0.52);
      } else if (variant === "b") {
        timeline
          .to("[data-product-rig]", { yPercent: -3, scale: 1.05, rotationX: 0, rotationY: 0 }, 0.12)
          .to("[data-system-layer='signal']", { xPercent: -39, yPercent: -8, rotationY: 8, z: 180 }, 0.32)
          .to("[data-system-layer='path']", { xPercent: 32, yPercent: -5, rotationY: -7, z: 260 }, 0.35)
          .to("[data-system-layer='status']", { xPercent: -22, yPercent: 55, z: 200 }, 0.38)
          .to("[data-system-layer='progress']", { xPercent: 28, yPercent: 210, z: 240 }, 0.4);
      } else {
        timeline
          .to("[data-product-rig]", { yPercent: -30, scale: 1.34, rotationX: 58, rotationY: 0 }, 0.12)
          .to("[data-product-object]", { transformOrigin: "50% 58%" }, 0.16)
          .to("[data-system-layer='path']", { scale: 1.15, y: 105 }, 0.38)
          .to("[data-product-rig]", { yPercent: -64, scale: 1.72 }, 0.55);
      }

      timeline
        .to("[data-product-rig]", { autoAlpha: 0.12 }, 0.72)
        .fromTo("[data-transition-scene]", { autoAlpha: 0, scale: 0.92 }, { autoAlpha: 1, scale: 1 }, 0.68)
        .fromTo("[data-transition-rail] li", { y: 90, autoAlpha: 0 }, { y: 0, autoAlpha: 1, stagger: 0.035 }, 0.75);
    });

    return () => mm.revert();
  }, { scope: root, dependencies: [variant], revertOnUpdate: true });

  return (
    <div ref={root} className={`${styles.lab} ${labDisplayV3.variable}`} data-variant={variant}>
      <nav className={styles.variantNav} data-variant-nav aria-label="Варианты Hero v3">
        <div>
          <span>HERO V3 / ВЫБОР НАПРАВЛЕНИЯ</span>
          <strong>{variants.find((item) => item.id === variant)?.note}</strong>
        </div>
        <div className={styles.variantTabs} role="tablist">
          {variants.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={variant === item.id} data-active={variant === item.id || undefined} onClick={() => setVariant(item.id)}>
              <b>{item.code}</b><span>{item.name}</span>
            </button>
          ))}
        </div>
      </nav>

      <section className={styles.heroPin} data-hero-pin>
        <div className={styles.heroStage} data-hero-stage>
          <div className={styles.atmosphere} aria-hidden="true" />
          <div className={styles.heroCopy} data-hero-copy>
            <p>ALPHA ACADEMY / STRUCTURED TRADING</p>
            <h1>Торгуй не на эмоциях.<br /><em>Иди по системе.</em></h1>
            <div>
              <span>Обучение, задания, наставник, Pocket checkpoint и прогресс собраны в одной системе.</span>
              <Link href="/register">Начать обучение <b>↗</b></Link>
            </div>
          </div>
          <ProductDashboard />
          <TransitionRail variant={variant} />
          <div className={styles.frameIndex} aria-hidden="true"><span>ALPHA / 03</span><span>SCROLL TO INSPECT</span></div>
        </div>
      </section>

      <section className={styles.stopPanel}>
        <span>STOP POINT / OWNER REVIEW</span>
        <h2>Выберите A, B или C.</h2>
        <p>Остальная страница намеренно не продолжена до утверждения hero.</p>
      </section>
    </div>
  );
}
