"use client";

/* eslint-disable @next/next/no-img-element -- news cover URLs are runtime-configurable */

import { labDisplayTqv2 } from "../lab-display-font";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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

function readingTime(content: string) {
  return Math.max(2, Math.ceil(content.trim().split(/\s+/).length / 180));
}

function impactFor(category: string) {
  const value = category.toLowerCase();
  if (value.includes("крипто") || value.includes("рынок")) return "Рыночный импульс";
  if (value.includes("риск")) return "Контроль риска";
  if (value.includes("обуч") || value.includes("практи") || value.includes("разбор")) return "Учебный контекст";
  return "Контекст платформы";
}

function OrbitVisual({ item }: { item: MockNewsItem }) {
  return item.coverImageUrl ? (
    <img src={item.coverImageUrl} alt="" loading="lazy" />
  ) : (
    <div className={styles.orbitTrace} aria-hidden="true">
      <svg viewBox="0 0 640 300" preserveAspectRatio="none">
        <path d="M0 242C38 230 72 250 112 214s72-5 112-36 66-62 108-44 64-48 112-26 68-58 108-34 66-42 100-38" />
        <path d="M0 282C48 260 88 286 132 250s78-8 126-42 76-64 126-40 72-38 118-24 78-32 138-20" />
      </svg>
      <span>{item.category}</span>
    </div>
  );
}

function NewsMeta({ item }: { item: MockNewsItem }) {
  return (
    <div className={styles.newsMeta}>
      <span>{item.date}</span>
      <span>{item.category}</span>
      <span>{readingTime(item.content)} мин</span>
    </div>
  );
}

export function TradeQuestNewsV2() {
  const root = useRef<HTMLDivElement>(null);
  const orbit = useRef<HTMLDivElement>(null);
  const paused = useRef(false);
  const gestureLocked = useRef(false);
  const [news, setNews] = useState<MockNewsItem[]>(mockNews);
  const [activeIndex, setActiveIndex] = useState(0);
  const [category, setCategory] = useState("Все");

  useEffect(() => {
    let active = true;
    getNews().then((result) => {
      if (active && result.data.length) setNews(result.data);
    });
    return () => {
      active = false;
    };
  }, []);

  const categories = useMemo(() => ["Все", ...Array.from(new Set(news.map((item) => item.category)))], [news]);
  const items = useMemo(() => category === "Все" ? news : news.filter((item) => item.category === category), [category, news]);
  const activeItem = items[activeIndex] ?? items[0];

  useEffect(() => {
    setActiveIndex(0);
  }, [category]);

  useEffect(() => {
    if (items.length < 2) return;
    const timer = window.setInterval(() => {
      if (!paused.current && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setActiveIndex((index) => (index + 1) % items.length);
      }
    }, 5200);
    return () => window.clearInterval(timer);
  }, [items.length]);

  const move = (direction: number) => {
    if (items.length < 2 || gestureLocked.current) return;
    gestureLocked.current = true;
    setActiveIndex((index) => (index + direction + items.length) % items.length);
    window.setTimeout(() => {
      gestureLocked.current = false;
    }, 360);
  };

  useGSAP(() => {
    const container = root.current;
    const target = orbit.current;
    if (!container || !target) return;

    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      const observer = ScrollTrigger.observe({
        target,
        type: "wheel,pointer,touch",
        lockAxis: true,
        tolerance: 18,
        dragMinimum: 24,
        preventDefault: false,
        onLeft: () => move(1),
        onRight: () => move(-1),
        onChangeY: (self) => {
          if (self.event?.type === "wheel") move(self.deltaY > 0 ? 1 : -1);
        },
      });
      return () => observer.kill();
    });

    return () => mm.revert();
  }, { scope: root, dependencies: [items.length], revertOnUpdate: true });

  useGSAP(() => {
    const cards = gsap.utils.toArray<HTMLElement>("[data-orbit-card]", root.current);
    if (!cards.length) return;
    const count = cards.length;

    cards.forEach((card, index) => {
      let distance = index - activeIndex;
      if (distance > count / 2) distance -= count;
      if (distance < -count / 2) distance += count;
      const magnitude = Math.abs(distance);
      const angle = distance * 27;
      const visible = magnitude <= 3;

      gsap.to(card, {
        x: Math.sin((angle * Math.PI) / 180) * Math.min(620, window.innerWidth * 0.42),
        y: magnitude * 42 + (distance % 2 === 0 ? 0 : 14),
        z: 170 - magnitude * 145,
        rotationY: distance * -13,
        rotationZ: distance * 1.4,
        scale: Math.max(0.62, 1 - magnitude * 0.11),
        autoAlpha: visible ? Math.max(0.24, 1 - magnitude * 0.2) : 0,
        duration: 0.76,
        ease: "power3.inOut",
        overwrite: true,
      });
    });
  }, { scope: root, dependencies: [activeIndex, items.length], revertOnUpdate: true });

  const pause = () => {
    paused.current = true;
  };
  const resume = () => {
    paused.current = false;
  };

  return (
    <div ref={root} className={`${styles.lab} ${styles.newsLab} ${labDisplayTqv2.variable}`}>
      <header className={styles.newsHeader}>
        <div className={styles.newsHeaderCopy}>
          <p className={styles.kicker}>Alpha Academy / Newsroom</p>
          <h1>Market<br /><em>Orbit.</em></h1>
          <p>Новости рынка, обучение и разборы собраны в движущийся поток сигналов.</p>
        </div>
        <div className={styles.marketContext}>
          <span><i /> Сигнальная лента</span>
          <b>{news.length} публикаций</b>
          <small>Обновляется редакцией</small>
        </div>
      </header>

      <nav className={styles.newsFilters} aria-label="Категории новостей" data-qa="filters">
        {categories.map((item) => (
          <button key={item} type="button" data-active={category === item ? "" : undefined} onClick={() => setCategory(item)}>{item}</button>
        ))}
      </nav>

      {activeItem ? (
        <section className={styles.orbitSection} aria-label="Market Orbit">
          <div className={styles.orbitBackdrop} aria-hidden="true"><i /><i /><i /></div>
          <div
            ref={orbit}
            className={styles.orbitViewport}
            data-qa="orbit"
            tabIndex={0}
            onPointerEnter={pause}
            onPointerLeave={resume}
            onFocusCapture={pause}
            onBlurCapture={resume}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") move(-1);
              if (event.key === "ArrowRight") move(1);
            }}
          >
            <div className={styles.orbitCards}>
              {items.map((item, index) => (
                <article key={item.id} className={styles.orbitCard} data-orbit-card data-active={index === activeIndex ? "" : undefined} aria-hidden={index !== activeIndex}>
                  <Link href={`/design-lab/tradequest-news-v2/${item.id}`} tabIndex={index === activeIndex ? 0 : -1} onFocus={() => setActiveIndex(index)}>
                    <OrbitVisual item={item} />
                    <div className={styles.orbitCardBody}>
                      <NewsMeta item={item} />
                      <h2>{item.title}</h2>
                      <p>{item.excerpt}</p>
                      <div className={styles.orbitCardFooter}><span>{item.author}</span><b>{impactFor(item.category)}</b></div>
                    </div>
                  </Link>
                </article>
              ))}
            </div>
            <div className={styles.orbitControls}>
              <button type="button" onClick={() => move(-1)} aria-label="Предыдущая новость">←</button>
              <span><b>{String(activeIndex + 1).padStart(2, "0")}</b> / {String(items.length).padStart(2, "0")}</span>
              <button type="button" onClick={() => move(1)} aria-label="Следующая новость">→</button>
            </div>
          </div>
        </section>
      ) : (
        <section className={styles.newsEmpty}><h2>В этой категории пока нет публикаций.</h2></section>
      )}

      <section className={styles.mobileNewsList} aria-label="Лента новостей">
        {items.map((item) => (
          <Link key={item.id} href={`/design-lab/tradequest-news-v2/${item.id}`} className={styles.mobileNewsCard}>
            <OrbitVisual item={item} />
            <div><NewsMeta item={item} /><h2>{item.title}</h2><p>{item.excerpt}</p><span>{impactFor(item.category)}</span></div>
          </Link>
        ))}
      </section>

      <footer className={styles.newsFooter}>
        <span>ALPHA ACADEMY / MARKET SIGNALS</span>
        <Link href="/design-lab/tradequest-home-v2">Вернуться к системе <b>↗</b></Link>
      </footer>
    </div>
  );
}
