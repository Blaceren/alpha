"use client";

import { labDisplayV7 } from "../lab-display-font";
import Link from "next/link";
import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ThemeToggle } from "@/components/ThemeToggle";
import styles from "./tradequest-hero-v7.module.css";


if (typeof window !== "undefined") gsap.registerPlugin(useGSAP, ScrollTrigger);

const routeSteps = [
  { number: "01", label: "Старт", state: "done", href: "/tasks" },
  { number: "02", label: "Платформа", state: "active", href: "/tasks" },
  { number: "03", label: "Практика", state: "next", href: "/tasks" },
  { number: "04", label: "Checkpoint", state: "locked", href: "/exchange" },
] as const;

const marketBars = [32, 44, 38, 58, 49, 66, 61, 78, 69, 86];

export function TradeQuestHeroV7() {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const scope = root.current;
    if (!scope) return;

    const mm = gsap.matchMedia();

    mm.add("(min-width: 1024px) and (prefers-reduced-motion: no-preference)", () => {
      const camera = scope.querySelector<HTMLElement>("[data-camera]");
      const light = scope.querySelector<HTMLElement>("[data-stage-light]");
      if (!camera || !light) return;

      const entry = gsap.timeline({ defaults: { ease: "power3.out" } });
      entry
        .from("[data-header-v7]", { y: -18, autoAlpha: 0, duration: 0.55 })
        .from("[data-copy-line]", { yPercent: 115, autoAlpha: 0, stagger: 0.09, duration: 0.7 }, 0.08)
        .from("[data-stage-light]", { scaleX: 0.35, autoAlpha: 0, duration: 0.9 }, 0.12)
        .from("[data-product-core]", { y: 38, scale: 0.94, rotationY: -7, autoAlpha: 0, duration: 0.85 }, 0.18)
        .from("[data-context]", { clipPath: "inset(0 100% 0 0)", autoAlpha: 0, stagger: 0.08, duration: 0.62 }, 0.48)
        .from("[data-route-node]", { scale: 0.55, autoAlpha: 0, stagger: 0.06, duration: 0.42 }, 0.62);

      const rotateX = gsap.quickTo(camera, "rotationX", { duration: 0.55, ease: "power3.out" });
      const rotateY = gsap.quickTo(camera, "rotationY", { duration: 0.55, ease: "power3.out" });
      const lightX = gsap.quickTo(light, "x", { duration: 0.7, ease: "power3.out" });
      const lightY = gsap.quickTo(light, "y", { duration: 0.7, ease: "power3.out" });

      const onPointerMove = (event: PointerEvent) => {
        const rect = scope.getBoundingClientRect();
        const x = (event.clientX - rect.left) / rect.width - 0.5;
        const y = (event.clientY - rect.top) / rect.height - 0.5;
        rotateX(-y * 4);
        rotateY(x * 4);
        lightX(x * 80);
        lightY(y * 36);
      };

      const resetPointer = () => {
        rotateX(0);
        rotateY(0);
        lightX(0);
        lightY(0);
      };

      scope.addEventListener("pointermove", onPointerMove);
      scope.addEventListener("pointerleave", resetPointer);

      const scroll = gsap.timeline({
        defaults: { ease: "none" },
        scrollTrigger: {
          trigger: scope,
          start: "top top",
          end: "+=520",
          scrub: 0.7,
          invalidateOnRefresh: true,
        },
      });
      scroll
        .to("[data-copy-v7]", { x: -48, autoAlpha: 0.32 }, 0)
        .to("[data-product-system]", { scale: 1.09, xPercent: -4, yPercent: -4 }, 0)
        .to("[data-active-step]", { z: 96, y: -14, scale: 1.025 }, 0.08)
        .to("[data-route-layer]", { z: 120, y: -8 }, 0.12)
        .to("[data-scroll-proof]", { autoAlpha: 1, y: 0 }, 0.54);

      return () => {
        scope.removeEventListener("pointermove", onPointerMove);
        scope.removeEventListener("pointerleave", resetPointer);
      };
    });

    return () => mm.revert();
  }, { scope: root });

  return (
    <div ref={root} className={`${styles.lab} ${labDisplayV7.variable}`} data-hero-v7>
      <header className={styles.header} data-header-v7>
        <Link href="/" className={styles.brand} aria-label="TradeQuest — главная">
          <span>TQ</span><strong>TradeQuest</strong>
        </Link>
        <nav className={styles.nav} aria-label="Навигация TradeQuest">
          <Link href="#product-stage">Программа</Link>
          <Link href="/news">Новости</Link>
          <Link href="/leaderboard">Рейтинг</Link>
        </nav>
        <div className={styles.headerActions}>
          <ThemeToggle />
          <Link href="/login" className={styles.login}>Войти</Link>
          <Link href="/register" className={styles.headerCta}>Начать обучение</Link>
        </div>
      </header>

      <main className={styles.hero}>
        <div className={styles.grain} aria-hidden="true" />
        <div className={styles.perspectiveGrid} aria-hidden="true" />
        <div className={styles.stageLight} data-stage-light aria-hidden="true" />
        <div className={styles.foreground} aria-hidden="true" />

        <section className={styles.copy} data-copy-v7 aria-labelledby="hero-v7-title">
          <p className={styles.kicker}>TradeQuest / управляемый путь трейдера</p>
          <h1 id="hero-v7-title">
            <span className={styles.lineMask}><span data-copy-line>Торгуй по</span></span>
            <span className={styles.lineMask}><span data-copy-line>системе.</span></span>
            <span className={`${styles.lineMask} ${styles.accentLine}`}><span data-copy-line>Не на эмоциях.</span></span>
          </h1>
          <p className={styles.lead}>
            Один маршрут соединяет уроки, практику, наставника и реальные контрольные точки.
          </p>
          <div className={styles.copyActions}>
            <Link href="/register" className={styles.primaryCta}>Начать обучение <span>→</span></Link>
            <span className={styles.copyNote}>16 этапов · прогресс сохраняется</span>
          </div>
        </section>

        <section id="product-stage" className={styles.productViewport} aria-label="Live product stage TradeQuest">
          <div className={styles.camera} data-camera>
            <div className={styles.productSystem} data-product-system>
              <div className={styles.backPlate} data-depth aria-hidden="true" />

              <article className={styles.productCore} data-product-core data-depth>
                <div className={styles.coreTopline}>
                  <div><span>LIVE ROUTE / 02</span><strong>Твой маршрут</strong></div>
                  <Link href="/levels" className={styles.levelDial} data-module="level">
                    <small>Уровень</small><b>2</b><span>15 XP</span>
                  </Link>
                </div>

                <Link href="/tasks" className={styles.activeStep} data-active-step data-module="active-step">
                  <div className={styles.stepMeta}><span>Активный шаг</span><b>В процессе</b></div>
                  <h2>Знакомство<br />с платформой</h2>
                  <p>Освой рабочее пространство и подготовься к первой серии сделок.</p>
                  <span className={styles.moduleAction}>Продолжить урок <b>→</b></span>
                </Link>

                <div className={styles.routeLayer} data-route-layer data-depth>
                  <span className={styles.routeOrigin}>Система</span>
                  <ol>
                    {routeSteps.map((step) => (
                      <li key={step.number} data-state={step.state} data-route-node>
                        <Link href={step.href}>
                          <i>{step.state === "done" ? "✓" : step.number}</i>
                          <span>{step.label}</span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                  <Link href="/levels" className={styles.progressReadout} data-module="progress">
                    <small>Выполнено</small><strong>1 / 16</strong><span><i /></span>
                  </Link>
                </div>
              </article>

              <Link href="/mentor-chat" className={`${styles.context} ${styles.mentor}`} data-context data-depth data-module="mentor">
                <span className={styles.contextIndex}>M</span>
                <div><small>Наставник</small><strong>На связи</strong><span>Разбор сегодня</span></div>
                <b className={styles.hoverAction}>Открыть чат →</b>
              </Link>

              <Link href="/news" className={`${styles.context} ${styles.market}`} data-context data-depth data-module="market">
                <div className={styles.marketTop}><span><small>Market pulse</small><strong>EUR / USD</strong></span><b>+0.32%</b></div>
                <div className={styles.marketBars} aria-hidden="true">
                  {marketBars.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
                </div>
                <span className={styles.hoverAction}>Новости рынка →</span>
              </Link>

              <Link href="/exchange" className={`${styles.context} ${styles.pocket}`} data-context data-depth data-module="pocket">
                <span className={styles.successDot} />
                <div><small>Pocket checkpoint</small><strong>Подключён</strong><span>Регистрация подтверждена</span></div>
                <b className={styles.hoverAction}>Открыть →</b>
              </Link>

              <Link href="/rewards/daily" className={`${styles.context} ${styles.reward}`} data-context data-depth data-module="reward">
                <small>Следующая награда</small><strong>+20 XP</strong><span>после урока</span>
                <b className={styles.hoverAction}>Награды →</b>
              </Link>

              <div className={styles.edgeLabel} aria-hidden="true"><span>DISCIPLINE / PROGRESS / PRACTICE</span></div>
            </div>
          </div>
        </section>

        <div className={styles.scrollProof} data-scroll-proof>
          <span>Следующая сцена</span><strong>Активный шаг выходит на первый план</strong>
        </div>
      </main>
    </div>
  );
}
