"use client";

import { useEffect, useRef, useState } from "react";
import { AcademyVideoPlayer } from "@/components/media/academy-video-player";

export type ShowcaseState =
  | "initial"
  | "playing"
  | "paused"
  | "loading"
  | "error"
  | "completed";

const STATE_LABELS: Array<{ id: ShowcaseState; label: string }> = [
  { id: "initial", label: "Начало" },
  { id: "playing", label: "Воспроизведение" },
  { id: "paused", label: "Пауза" },
  { id: "loading", label: "Загрузка" },
  { id: "error", label: "Ошибка" },
  { id: "completed", label: "Завершено" },
];

function setFixtureMediaValues(video: HTMLVideoElement, state: ShowcaseState) {
  try {
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: 584,
    });
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      writable: true,
      value: state === "completed" ? 584 : state === "initial" ? 0 : 126,
    });
  } catch {
    // Real media metadata remains authoritative when browser properties are sealed.
  }
}

export function VideoPlayerShowcase({
  initialState,
}: {
  initialState: ShowcaseState;
}) {
  const [state, setState] = useState(initialState);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const video = previewRef.current?.querySelector("video");
    if (!video) return;

    const timer = window.setTimeout(() => {
      setFixtureMediaValues(video, state);
      video.dispatchEvent(new Event("loadedmetadata"));

      if (state === "initial") return;

      if (state === "error") {
        video.dispatchEvent(new Event("error"));
        return;
      }

      video.dispatchEvent(new Event("play"));
      video.dispatchEvent(new Event("timeupdate"));

      if (state === "loading") video.dispatchEvent(new Event("waiting"));
      if (state === "paused") video.dispatchEvent(new Event("pause"));
      if (state === "completed") video.dispatchEvent(new Event("ended"));
    }, 80);

    return () => window.clearTimeout(timer);
  }, [state]);

  return (
    <main className="vps">
      <header className="vps__header">
        <div className="vps__brand" aria-label="Alfa Trade Academy">
          <span className="vps__brand-mark" aria-hidden="true">
            A
          </span>
          <span>Alfa Trade Academy</span>
        </div>
        <span className="vps__meta">Component showcase / Media</span>
      </header>

      <section className="vps__stage" aria-labelledby="showcase-title">
        <div className="vps__intro">
          <p>Учебная среда</p>
          <h1 id="showcase-title">Видео для урока. Без лишнего шума.</h1>
          <span>
            Самостоятельный HTML5-плеер для уроков Academy. Состояния ниже
            принадлежат только showcase.
          </span>
        </div>

        <div className="vps__toolbar" aria-label="Состояние плеера">
          {STATE_LABELS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={state === item.id}
              onClick={() => setState(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div ref={previewRef} className="vps__preview">
          <AcademyVideoPlayer
            key={state}
            src="/showcase/video-player/academy-lesson-demo.webm"
            title="Поддержка и сопротивление"
            description="Как находить ключевые области на графике и не принимать шум за сигнал."
            captions={[
              {
                src: "/showcase/video-player/academy-demo-ru.vtt",
                srcLang: "ru",
                label: "Русский",
              },
            ]}
          />
        </div>

        <footer className="vps__footer">
          <div>
            <span>Текущий материал</span>
            <strong>Уровень 18 · Чтение графика</strong>
          </div>
          <div>
            <span>Управление</span>
            <strong>Space / ← → / M / F</strong>
          </div>
          <div>
            <span>Состояние</span>
            <strong>{STATE_LABELS.find((item) => item.id === state)?.label}</strong>
          </div>
        </footer>
      </section>
    </main>
  );
}
