"use client";

/* eslint-disable @next/next/no-img-element -- news cover URLs are runtime-configurable */

import { labDisplayTqv2 } from "../lab-display-font";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { MockNewsItem } from "@/data/mockNews";
import { mockNews } from "@/data/mockNews";
import { getNews } from "@/lib/api";
import styles from "./tradequest-v2.module.css";


if (typeof window !== "undefined") {
  gsap.registerPlugin(useGSAP, ScrollTrigger);
}

const pathSteps = [
  ["01", "Диагностика", "done"],
  ["02", "Уроки", "done"],
  ["03", "Практика", "active"],
  ["04", "Наставник", "next"],
  ["05", "Pocket", "next"],
  ["06", "Прогресс", "goal"],
] as const;

const productPanels = [
  { key: "tasks", label: "Задания", title: "Активный этап", value: "03 Практика", tone: "signal" },
  { key: "mentor", label: "Наставник", title: "Отчёт", value: "Проверяется наставником", tone: "amber" },
  { key: "exchange", label: "Pocket", title: "Checkpoint", value: "Готово", tone: "green" },
  { key: "progress", label: "Прогресс", title: "XP", value: "420 / 700", tone: "blue" },
] as const;

const systemNotes = ["Уроки", "Задания", "Наставник", "Pocket", "XP"];

function SignalChart({ compact = false }: { compact?: boolean }) {
  return (
    <svg className={compact ? styles.chartCompact : styles.chart} viewBox="0 0 760 220" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={compact ? "tqv2-chart-fill-c" : "tqv2-chart-fill"} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".22" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className={styles.chartGrid} d="M0 44H760M0 88H760M0 132H760M0 176H760" />
      <path className={styles.chartArea} fill={`url(#${compact ? "tqv2-chart-fill-c" : "tqv2-chart-fill"})`} d="M0 184C54 180 84 142 132 150S220 108 270 122s72-52 130-36 82-30 130-12 68-46 122-26 70-30 108-38V220H0Z" />
      <path className={styles.chartLine} d="M0 184C54 180 84 142 132 150S220 108 270 122s72-52 130-36 82-30 130-12 68-46 122-26 70-30 108-38" />
    </svg>
  );
}

function DashboardObject() {
  return (
    <div className={styles.dashboardWrap} data-hero-object>
      <div className={styles.dashboardEdge} aria-hidden="true" />
      <article className={styles.dashboard}>
        <header className={styles.dashboardHeader}>
          <div>
            <span className={styles.micro}>Alpha Academy</span>
            <strong>Панель прогресса</strong>
          </div>
          <div className={styles.levelBadge}>
            <span>Уровень</span>
            <b>7 / 16</b>
          </div>
        </header>

        <div className={styles.dashboardChart}>
          <SignalChart />
          <div className={styles.chartCaption}>
            <span>Путь трейдера</span>
            <b>Системный прогресс</b>
          </div>
        </div>

        <ol className={styles.dashboardPath} aria-label="Путь трейдера">
          {pathSteps.map(([number, label, state]) => (
            <li key={number} data-state={state}>
              <span className={styles.stepNode}>{state === "done" ? "✓" : number}</span>
              <span>{label}</span>
              {state === "active" ? <small>Вы здесь</small> : null}
            </li>
          ))}
        </ol>

        <div className={styles.dashboardStatus}>
          <div>
            <span>Активное задание</span>
            <strong>03 Практика</strong>
          </div>
          <div>
            <span>Отчёт наставнику</span>
            <strong>Проверяется наставником</strong>
          </div>
          <div>
            <span>Pocket checkpoint</span>
            <strong data-tone="green">Готово</strong>
          </div>
        </div>

        <div className={styles.xpRow}>
          <span>XP прогресс</span>
          <div><i /></div>
          <b>420 / 700</b>
        </div>
      </article>

      <aside className={`${styles.floatPanel} ${styles.floatPanelMentor}`} data-layer="mentor">
        <span>Наставник</span>
        <b>Отчёт принят</b>
        <small>Следующий шаг открыт</small>
      </aside>
      <aside className={`${styles.floatPanel} ${styles.floatPanelPocket}`} data-layer="pocket">
        <span>Pocket checkpoint</span>
        <b>Готово</b>
        <small>Статус подтверждён</small>
      </aside>
      <aside className={`${styles.floatPanel} ${styles.floatPanelXp}`} data-layer="xp">
        <span>XP</span>
        <b>+15</b>
        <small>Прогресс сохранён</small>
      </aside>
    </div>
  );
}

function ProductMiniScreen({ panel, index }: { panel: (typeof productPanels)[number]; index: number }) {
  return (
    <article className={styles.productScreen} data-showcase-card data-tone={panel.tone} style={{ "--screen-index": index } as React.CSSProperties}>
      <header>
        <span>{panel.label}</span>
        <i aria-hidden="true" />
      </header>
      <div className={styles.productScreenBody}>
        <span>{panel.title}</span>
        <strong>{panel.value}</strong>
        {panel.key === "progress" ? <div className={styles.miniProgress}><i /></div> : <SignalChart compact />}
      </div>
      <footer>
        <span>ALPHA / {String(index + 1).padStart(2, "0")}</span>
        <span>Signal system</span>
      </footer>
    </article>
  );
}

function NewsVisual({ item }: { item: MockNewsItem }) {
  return item.coverImageUrl ? (
    <img src={item.coverImageUrl} alt="" loading="lazy" />
  ) : (
    <div className={styles.newsTrace} aria-hidden="true">
      <SignalChart />
      <span>{item.category}</span>
    </div>
  );
}

export function TradeQuestHomeV2() {
  const root = useRef<HTMLDivElement>(null);
  const [showLoader, setShowLoader] = useState(false);
  const [news, setNews] = useState<MockNewsItem[]>(mockNews.slice(0, 5));

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion && !window.sessionStorage.getItem("tqv2-seen")) {
      window.sessionStorage.setItem("tqv2-seen", "1");
      setShowLoader(true);
      const timer = window.setTimeout(() => setShowLoader(false), 820);
      return () => window.clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getNews().then((result) => {
      if (active && result.data.length) setNews(result.data.slice(0, 5));
    });
    return () => {
      active = false;
    };
  }, []);

  useGSAP(() => {
    const scope = root.current;
    if (!scope) return;

    const mm = gsap.matchMedia();
    mm.add(
      {
        desktop: "(min-width: 1024px)",
        finePointer: "(pointer: fine)",
        reduceMotion: "(prefers-reduced-motion: reduce)",
      },
      (context) => {
        const { desktop, finePointer, reduceMotion } = context.conditions ?? {};
        const reveals = gsap.utils.toArray<HTMLElement>("[data-reveal]", scope);

        if (reduceMotion) {
          gsap.set(reveals, { clearProps: "all" });
          return;
        }

        if (desktop) {
          const hero = gsap.timeline({
            defaults: { ease: "none" },
            scrollTrigger: {
              trigger: "[data-hero-pin]",
              start: "top 64px",
              end: () => `+=${Math.round(window.innerHeight * 1.8)}`,
              pin: "[data-hero-stage]",
              scrub: 0.65,
              invalidateOnRefresh: true,
              anticipatePin: 1,
            },
          });

          hero
            .addLabel("contact")
            .to("[data-hero-copy]", { xPercent: -16, autoAlpha: 0.18, scale: 0.92 }, 0.16)
            .to("[data-hero-object]", { xPercent: -28, yPercent: 3, scale: 1.08, rotationX: 1, rotationY: -1 }, 0.12)
            .to("[data-layer='mentor']", { xPercent: -32, yPercent: -36, z: 150, rotationY: 3 }, 0.2)
            .to("[data-layer='pocket']", { xPercent: 26, yPercent: -14, z: 190, rotationY: -4 }, 0.29)
            .to("[data-layer='xp']", { xPercent: 18, yPercent: 42, z: 130, rotationX: -3 }, 0.38)
            .fromTo("[data-system-note]", { autoAlpha: 0, x: 28 }, { autoAlpha: 1, x: 0, stagger: 0.08 }, 0.32)
            .fromTo("[data-signal-spine]", { scaleX: 0 }, { scaleX: 1, transformOrigin: "left center" }, 0.5)
            .to("[data-hero-object]", { yPercent: -10, scale: 0.94, rotationX: -2 }, 0.74)
            .to("[data-system-note]", { autoAlpha: 0, y: -18, stagger: 0.025 }, 0.83);

          const showcase = gsap.timeline({
            defaults: { ease: "none" },
            scrollTrigger: {
              trigger: "[data-showcase-pin]",
              start: "top 64px",
              end: () => `+=${Math.round(window.innerHeight * 1.6)}`,
              pin: "[data-showcase-stage]",
              scrub: 0.7,
              invalidateOnRefresh: true,
              anticipatePin: 1,
            },
          });

          showcase
            .fromTo("[data-showcase-card]", { xPercent: 0, yPercent: 16, rotationY: 0, rotationZ: 0, scale: 0.88 }, {
              xPercent: (index) => (index - 1.5) * 46,
              yPercent: (index) => Math.abs(index - 1.5) * 8,
              rotationY: (index) => (index - 1.5) * -8,
              rotationZ: (index) => (index - 1.5) * 2.6,
              scale: (index) => 1 - Math.abs(index - 1.5) * 0.045,
              stagger: 0.045,
            }, 0.08)
            .to("[data-showcase-copy]", { autoAlpha: 0, y: -28 }, 0.5)
            .to("[data-showcase-card]", { xPercent: (index) => (index - 1.5) * 72, z: -180, autoAlpha: 0.32 }, 0.58)
            .fromTo("[data-news-bridge]", { autoAlpha: 0, scale: 0.72, z: -220 }, { autoAlpha: 1, scale: 1, z: 120 }, 0.62)
            .fromTo("[data-orbit-dot]", { autoAlpha: 0, scale: 0 }, { autoAlpha: 1, scale: 1, stagger: 0.05 }, 0.72);
        }

        ScrollTrigger.batch(reveals, {
          start: "top 86%",
          once: true,
          onEnter: (elements) => gsap.fromTo(elements, { autoAlpha: 0, y: 36 }, { autoAlpha: 1, y: 0, duration: 0.72, stagger: 0.08, ease: "power3.out", overwrite: true }),
          onLeave: (elements) => gsap.set(elements, { autoAlpha: 1, y: 0 }),
        });

        if (finePointer) {
          const object = scope.querySelector<HTMLElement>("[data-hero-object]");
          const stage = scope.querySelector<HTMLElement>("[data-hero-stage]");
          if (object && stage) {
            const rx = gsap.quickTo(object, "rotationX", { duration: 0.7, ease: "power3.out" });
            const ry = gsap.quickTo(object, "rotationY", { duration: 0.7, ease: "power3.out" });
            const move = (event: PointerEvent) => {
              const rect = stage.getBoundingClientRect();
              rx(gsap.utils.mapRange(rect.top, rect.bottom, 2.2, -2.2, event.clientY));
              ry(gsap.utils.mapRange(rect.left, rect.right, -2.8, 2.8, event.clientX));
            };
            const reset = () => {
              rx(0);
              ry(-5);
            };
            stage.addEventListener("pointermove", move);
            stage.addEventListener("pointerleave", reset);
            return () => {
              stage.removeEventListener("pointermove", move);
              stage.removeEventListener("pointerleave", reset);
            };
          }
        }
      },
    );

    document.fonts.ready.then(() => ScrollTrigger.refresh(true));
    return () => mm.revert();
  }, { scope: root });

  return (
    <div ref={root} className={`${styles.lab} ${labDisplayTqv2.variable}`}>
      {showLoader ? (
        <div className={styles.loader} aria-hidden="true">
          <span>ALPHA ACADEMY</span>
          <i />
          <small>SIGNAL SYSTEM / 12</small>
        </div>
      ) : null}

      <section className={styles.heroPin} data-hero-pin>
        <div className={styles.heroStage} data-hero-stage>
          <div className={styles.signalField} aria-hidden="true"><SignalChart /></div>
          <div className={styles.heroCopy} data-hero-copy>
            <p className={styles.kicker}>Структурное обучение трейдингу</p>
            <h1>Торгуй не на эмоциях.<br /><em>Иди по системе.</em></h1>
            <p className={styles.heroLead}>Alpha Academy собирает обучение, задания, проверки наставника, Pocket checkpoint’ы и прогресс в одном понятном дашборде.</p>
            <div className={styles.heroActions}>
              <Link href="/register" className={styles.primaryAction}>Начать обучение <span>↗</span></Link>
              <a href="#signal-system" className={styles.textAction}>Смотреть систему <span>↓</span></a>
            </div>
            <p className={styles.proofLine}>16 уровней · отчёты наставнику · XP-прогресс · Pocket checkpoint’ы</p>
          </div>
          <DashboardObject />
          <div className={styles.systemNotes} aria-hidden="true">
            {systemNotes.map((note, index) => <span key={note} data-system-note style={{ "--note-index": index } as React.CSSProperties}>{note}</span>)}
          </div>
          <i className={styles.signalSpine} data-signal-spine aria-hidden="true" />
        </div>
      </section>

      <section id="signal-system" className={styles.journey} data-qa="journey">
        <header className={styles.sceneHeading} data-reveal>
          <p className={styles.kicker}>Путь трейдера / 01—06</p>
          <h2>Система сохраняет контекст от первого урока до подтверждённого прогресса.</h2>
        </header>
        <div className={styles.journeyRail}>
          {pathSteps.map(([number, label, state], index) => (
            <article key={number} className={styles.journeyStep} data-state={state} data-reveal>
              <span className={styles.journeyNumber}>{number}</span>
              <div><h3>{label}</h3><p>{index < 2 ? "Завершено" : index === 2 ? "Активный этап" : index === 5 ? "Контрольная точка" : "Следующий шаг"}</p></div>
              <i aria-hidden="true" />
            </article>
          ))}
        </div>
      </section>

      <section className={styles.connectedScenes} data-qa="connected-scenes">
        <article className={styles.learningScene} data-reveal>
          <div className={styles.sceneIndex}>03 / Практика</div>
          <div className={styles.taskSheet}>
            <span>Активное задание</span><strong>Отчёт по торговой сессии</strong>
            <div><i /><i /><i /></div>
          </div>
          <div className={styles.mentorFlow}>
            <span>Отчёт</span><i>→</i><span>Проверяется наставником</span><i>→</i><span data-done>Готово</span>
          </div>
        </article>

        <article className={styles.pocketScene} data-reveal>
          <div>
            <p className={styles.kicker}>05 / Pocket checkpoint</p>
            <h2>Регистрация → Депозит → Postback</h2>
          </div>
          <div className={styles.checkpointPipeline}>
            {["Регистрация", "Депозит", "Postback"].map((label, index) => <span key={label} data-active={index === 2 ? "" : undefined}><i>{index + 1}</i>{label}</span>)}
          </div>
          <div className={styles.checkpointSeal}><span>Статус</span><b>Готово</b><small>Checkpoint подтверждён</small></div>
        </article>

        <article className={styles.progressScene} data-reveal>
          <div><p className={styles.kicker}>06 / Прогресс</p><h2>Рост виден в системе.</h2></div>
          <div className={styles.progressNumbers}>
            <span><small>Уровень</small><b>7<em>/16</em></b></span>
            <span><small>XP</small><b>420<em>/700</em></b></span>
            <span><small>Pocket</small><b data-ready>Готово</b></span>
          </div>
        </article>
      </section>

      <section className={styles.showcasePin} data-showcase-pin>
        <div className={styles.showcaseStage} data-showcase-stage>
          <header className={styles.showcaseCopy} data-showcase-copy>
            <p className={styles.kicker}>Product system</p>
            <h2>Один продукт.<br />Один маршрут.</h2>
          </header>
          <div className={styles.productFan}>
            {productPanels.map((panel, index) => <ProductMiniScreen key={panel.key} panel={panel} index={index} />)}
          </div>
          <article className={styles.newsBridge} data-news-bridge>
            <NewsVisual item={news[0]} />
            <div><span>{news[0].category}</span><h3>{news[0].title}</h3><p>{news[0].excerpt}</p></div>
          </article>
          <div className={styles.orbitDots} aria-hidden="true">{news.slice(1, 5).map((item, index) => <i key={item.id} data-orbit-dot style={{ "--dot-index": index } as React.CSSProperties} />)}</div>
        </div>
      </section>

      <section className={styles.newsTeaser} data-reveal data-qa="news-teaser">
        <header>
          <div><p className={styles.kicker}>Market Orbit</p><h2>Рыночные события в едином потоке.</h2></div>
          <Link href="/design-lab/tradequest-news-v2" className={styles.secondaryAction}>Все новости <span>↗</span></Link>
        </header>
        <div className={styles.newsTeaserGrid}>
          {news.slice(0, 5).map((item, index) => (
            <Link key={item.id} href={`/design-lab/tradequest-news-v2/${item.id}`} className={styles.teaserCard} data-featured={index === 0 ? "" : undefined}>
              <NewsVisual item={item} />
              <div><span>{item.date} · {item.category}</span><h3>{item.title}</h3>{index === 0 ? <p>{item.excerpt}</p> : null}</div>
            </Link>
          ))}
        </div>
      </section>

      <section className={styles.productProof} data-reveal>
        <div><p className={styles.kicker}>Система в продукте</p><h2>16 уровней. Последовательные этапы. Проверяемые статусы.</h2></div>
        <div className={styles.levelStrip}>{Array.from({ length: 16 }, (_, index) => <span key={index} data-state={index < 6 ? "done" : index === 6 ? "active" : "next"}>{String(index + 1).padStart(2, "0")}</span>)}</div>
        <Link href="/leaderboard" className={styles.textAction}>Открыть лидерборд <span>↗</span></Link>
      </section>

      <section className={styles.finalCta} data-reveal data-qa="final-cta">
        <div className={styles.finalSignal} aria-hidden="true"><SignalChart /></div>
        <p className={styles.kicker}>Следующий шаг / 01</p>
        <h2>Начать обучение</h2>
        <Link href="/register" className={styles.primaryAction}>Начать обучение <span>↗</span></Link>
      </section>
    </div>
  );
}
