"use client";

/* eslint-disable @next/next/no-img-element -- news media URLs are runtime-configurable */

import { labDisplayTqv2 } from "../lab-display-font";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import type { MockNewsItem } from "@/data/mockNews";
import { mockNews } from "@/data/mockNews";
import { getNews, getNewsItem } from "@/lib/api";
import styles from "./tradequest-v2.module.css";


if (typeof window !== "undefined") {
  gsap.registerPlugin(useGSAP, ScrollTrigger);
}

function readingTime(content: string) {
  return Math.max(2, Math.ceil(content.trim().split(/\s+/).length / 180));
}

function ArticleVisual({ item }: { item: MockNewsItem }) {
  return item.coverImageUrl ? (
    <img src={item.coverImageUrl} alt="" />
  ) : (
    <div className={styles.articleTrace} aria-hidden="true">
      <svg viewBox="0 0 1200 480" preserveAspectRatio="none">
        <path d="M0 390C76 362 126 404 206 332s136-12 210-86 132-114 210-70 120-86 210-46 122-100 200-54 110-78 164-60" />
        <path d="M0 438C90 402 154 454 244 388s144-30 226-88 138-76 222-44 128-52 212-18 126-48 296-42" />
      </svg>
      <span>{item.category}</span>
    </div>
  );
}

export function TradeQuestNewsArticleV2({ slug }: { slug: string }) {
  const root = useRef<HTMLDivElement>(null);
  const article = useRef<HTMLElement>(null);
  const progress = useRef<HTMLSpanElement>(null);
  const fallback = mockNews.find((item) => item.id === slug) ?? null;
  const [item, setItem] = useState<MockNewsItem | null>(fallback);
  const [related, setRelated] = useState<MockNewsItem[]>(mockNews.filter((entry) => entry.id !== slug).slice(0, 3));
  const [loading, setLoading] = useState(!fallback);

  useEffect(() => {
    let active = true;
    Promise.all([getNewsItem(slug), getNews()]).then(([detail, list]) => {
      if (!active) return;
      if (detail.data) setItem(detail.data);
      if (list.data.length) setRelated(list.data.filter((entry) => entry.id !== slug).slice(0, 3));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [slug]);

  useGSAP(() => {
    if (!article.current || !progress.current) return;
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.from("[data-article-intro]", { y: 24, autoAlpha: 0, duration: 0.72, stagger: 0.08, ease: "power3.out" });
      ScrollTrigger.create({
        trigger: article.current,
        start: "top top",
        end: "bottom bottom",
        onUpdate: (self) => gsap.set(progress.current, { scaleX: self.progress, transformOrigin: "left center" }),
      });
    });
    return () => mm.revert();
  }, { scope: root, dependencies: [item?.id], revertOnUpdate: true });

  if (loading && !item) {
    return <div className={`${styles.lab} ${styles.articleLab} ${labDisplayTqv2.variable}`}><div className={styles.articleLoading}>Загрузка публикации…</div></div>;
  }

  if (!item) {
    return (
      <div className={`${styles.lab} ${styles.articleLab} ${labDisplayTqv2.variable}`}>
        <section className={styles.articleMissing}><p className={styles.kicker}>Market Orbit</p><h1>Новость не найдена</h1><Link href="/design-lab/tradequest-news-v2">Вернуться к ленте</Link></section>
      </div>
    );
  }

  return (
    <div ref={root} className={`${styles.lab} ${styles.articleLab} ${labDisplayTqv2.variable}`}>
      <span ref={progress} className={styles.readingProgress} aria-hidden="true" />
      <nav className={styles.articleNav} data-article-intro>
        <Link href="/design-lab/tradequest-news-v2">← Market Orbit</Link>
        <span>ALPHA ACADEMY / NEWSROOM</span>
      </nav>

      <article ref={article} className={styles.article}>
        <header className={styles.articleHeader}>
          <div className={styles.newsMeta} data-article-intro><span>{item.date}</span><span>{item.category}</span><span>{readingTime(item.content)} мин</span></div>
          <h1 data-article-intro>{item.title}</h1>
          <p data-article-intro>{item.excerpt}</p>
          <div className={styles.articleByline} data-article-intro><span>Источник</span><b>{item.author}</b></div>
        </header>

        <figure className={styles.articleCover} data-article-intro data-qa="article-cover"><ArticleVisual item={item} /></figure>

        <div className={styles.articleBody}>
          {item.content.split(/\n+/).filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}
          {item.mediaUrl && item.mediaType === "image" ? <img src={item.mediaUrl} alt="" loading="lazy" /> : null}
          {item.mediaUrl && item.mediaType === "video" ? <video src={item.mediaUrl} controls /> : null}
        </div>
      </article>

      <section className={styles.relatedNews}>
        <header><p className={styles.kicker}>Дальше по ленте</p><h2>Связанные сигналы</h2></header>
        <div>
          {related.map((entry) => (
            <Link key={entry.id} href={`/design-lab/tradequest-news-v2/${entry.id}`}>
              <span>{entry.date} · {entry.category}</span><h3>{entry.title}</h3><b>Читать ↗</b>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
