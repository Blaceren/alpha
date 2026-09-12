"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ThemeToggle } from "@/components/ThemeToggle";
import styles from "./tradequest-hero-v6.module.css";

const modules = [
  {
    key: "mentor",
    eyebrow: "Наставник",
    title: "На связи",
    detail: "Ответит на отчёт сегодня",
    href: "/mentor-chat",
    marker: "M",
  },
  {
    key: "pocket",
    eyebrow: "Pocket checkpoint",
    title: "Подключён",
    detail: "Регистрация подтверждена",
    href: "/exchange",
    marker: "P",
  },
  {
    key: "reward",
    eyebrow: "Следующая награда",
    title: "+20 XP",
    detail: "После завершения урока",
    href: "/rewards/daily",
    marker: "+",
  },
] as const;

export function TradeQuestHeroV6() {
  const root = useRef<HTMLDivElement>(null);
  const dashboard = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scope = root.current;
    const panel = dashboard.current;
    if (!scope || !panel) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;

    const setScrollProgress = () => {
      frame = 0;
      const rect = scope.getBoundingClientRect();
      const distance = Math.max(scope.offsetHeight - window.innerHeight, 1);
      const progress = Math.min(Math.max(-rect.top / distance, 0), 1);
      scope.style.setProperty("--scroll-progress", progress.toFixed(3));
    };

    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(setScrollProgress);
    };

    const onPointerMove = (event: PointerEvent) => {
      if (reduceMotion.matches || event.pointerType === "touch") return;
      const rect = panel.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      panel.style.setProperty("--tilt-x", `${(-y * 4).toFixed(2)}deg`);
      panel.style.setProperty("--tilt-y", `${(x * 4).toFixed(2)}deg`);
    };

    const resetPointer = () => {
      panel.style.setProperty("--tilt-x", "0deg");
      panel.style.setProperty("--tilt-y", "0deg");
    };

    setScrollProgress();
    window.addEventListener("scroll", onScroll, { passive: true });
    panel.addEventListener("pointermove", onPointerMove);
    panel.addEventListener("pointerleave", resetPointer);

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      panel.removeEventListener("pointermove", onPointerMove);
      panel.removeEventListener("pointerleave", resetPointer);
    };
  }, []);

  return (
    <div ref={root} className={styles.lab} data-hero-v6>
      <header className={styles.siteHeader}>
        <Link href="/" className={styles.brand} aria-label="TradeQuest — главная">
          <span>TQ</span>
          <strong>TradeQuest</strong>
        </Link>
        <nav className={styles.siteNav} aria-label="Навигация TradeQuest">
          <Link href="#dashboard-v6">Программа</Link>
          <Link href="/news">Новости</Link>
          <Link href="/leaderboard">Рейтинг</Link>
        </nav>
        <div className={styles.headerActions}>
          <ThemeToggle />
          <Link href="/login" className={styles.loginAction}>Войти</Link>
          <Link href="/register" className={styles.headerCta}>Начать обучение</Link>
        </div>
      </header>

      <div className={styles.routeArc} aria-hidden="true" />
      <div className={styles.gridTexture} aria-hidden="true" />

      <section className={styles.heroStage} aria-labelledby="hero-v6-title">
        <div className={styles.heroCopy} data-hero-copy>
          <p className={styles.eyebrow}>TradeQuest · обучение через практику</p>
          <h1 id="hero-v6-title">
            Торгуй по системе.
            <span>Не на эмоциях.</span>
          </h1>
          <p className={styles.lead}>
            Пошаговые задания, практика и обратная связь наставника помогают
            двигаться по рынку с понятным планом.
          </p>
          <div className={styles.heroActions}>
            <Link href="/register" className={styles.primaryAction}>
              Начать обучение <span aria-hidden="true">→</span>
            </Link>
            <Link href="/tasks" className={styles.secondaryAction}>
              Посмотреть программу
            </Link>
          </div>
          <p className={styles.proof}>16 шагов · наставник · XP · Pocket checkpoint</p>
        </div>

        <div id="dashboard-v6" className={styles.dashboardScene} data-dashboard-scene>
          <div
            ref={dashboard}
            className={styles.dashboard}
            data-dashboard
            aria-label="Интерактивная панель прогресса пользователя"
          >
            <div className={styles.dashboardTopline}>
              <div>
                <p>Личный маршрут</p>
                <h2>Твой следующий шаг</h2>
              </div>
              <Link href="/levels" className={styles.levelBadge} data-module="level">
                <span>Уровень</span>
                <strong>2</strong>
              </Link>
            </div>

            <div className={styles.dashboardGrid}>
              <Link href="/tasks" className={styles.activeStep} data-module="active-step">
                <div className={styles.moduleHeading}>
                  <span className={styles.moduleIndex}>02</span>
                  <span className={styles.statusActive}>В процессе</span>
                </div>
                <p className={styles.moduleEyebrow}>Активное задание</p>
                <h3>Пройти урок: знакомство с платформой</h3>
                <p className={styles.moduleDescription}>
                  Разбери рабочее пространство и подготовься к первой серии сделок.
                </p>
                <div className={styles.nextAction}>
                  <span>Продолжить урок</span>
                  <b aria-hidden="true">→</b>
                </div>
              </Link>

              <Link href="/levels" className={styles.progressModule} data-module="progress">
                <div className={styles.progressHeader}>
                  <div>
                    <p className={styles.moduleEyebrow}>Общий прогресс</p>
                    <h3>Выполнено 1 из 16</h3>
                  </div>
                  <strong>15%</strong>
                </div>
                <div className={styles.progressTrack} aria-label="15 процентов">
                  <span />
                </div>
                <div className={styles.xpRow}>
                  <span>15 / 100 XP</span>
                  <span>До уровня 3: 85 XP</span>
                </div>
              </Link>

              <div className={styles.moduleStrip}>
                {modules.map((module) => (
                  <Link
                    key={module.key}
                    href={module.href}
                    className={styles.compactModule}
                    data-module={module.key}
                  >
                    <span className={styles.moduleMarker} data-positive={module.key === "pocket" || undefined}>
                      {module.marker}
                    </span>
                    <span className={styles.compactCopy}>
                      <small>{module.eyebrow}</small>
                      <strong>{module.title}</strong>
                      <span>{module.detail}</span>
                    </span>
                    <b className={styles.moduleArrow} aria-hidden="true">→</b>
                  </Link>
                ))}
              </div>
            </div>

            <div className={styles.dashboardFoot}>
              <span><i /> Система активна</span>
              <Link href="/leaderboard">Место в рейтинге: 12</Link>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.transitionCue} aria-label="Следующий шаг обучения">
        <p>Следующий шаг</p>
        <strong>Знакомство с платформой</strong>
        <span>Панель остаётся рядом, пока ты двигаешься по маршруту.</span>
      </section>
    </div>
  );
}
