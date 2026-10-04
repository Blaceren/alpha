"use client";

import { useState } from "react";
import { AcademyVideoPlayer } from "@/components/media/academy-video-player";
import type { PublicFilm } from "@/server/media/public-film";

const FILM_TITLE = "Как устроена Alpha Trade Academy";
/** The cycle the film walks through — the same six words as «Как это работает». */
const CYCLE = ["Понять", "Решить", "Действовать", "Проверить", "Исправить", "Продвинуться"] as const;

/**
 * THE FILM IN THE FIRST SCREEN (2026-10-04, owner: «оставляли место для плеера —
 * давай его туда поставим уже»; «Пока нет — плеер с обложкой»).
 *
 * The frame the hero kept for it since 2026-09-22 — the Decision Frame's
 * viewfinder corners on its grid — now holds the film's stage at 16:9. Until a
 * film is on the host the stage is its cover and says «Скоро», with no control
 * that does nothing. When the film is there the same cover is its poster with
 * one play control, and pressing it puts the product's own player in its place
 * (`AcademyVideoPlayer`, the lessons' player) and starts it — a click is what
 * lets it start with sound. Nothing plays by itself.
 */
export function HeroFilm({ film }: { film: PublicFilm | null }) {
  const [watching, setWatching] = useState(false);
  const ready = film !== null;

  return (
    <figure className="dframe dframe--film hfilm" data-reveal data-film={ready ? "ready" : "soon"}>
      <figcaption className="hfilm__label">
        <span className="hfilm__eyebrow">Фильм о платформе</span>
        {ready ? null : <span className="hfilm__soon">Скоро</span>}
      </figcaption>

      <div className="hfilm__stage">
        {ready && watching ? (
          <AcademyVideoPlayer
            src={film.src}
            poster={film.poster ?? undefined}
            title={FILM_TITLE}
            captions={film.captions ? [{ src: film.captions, srcLang: "ru", label: "Русские", default: true }] : undefined}
            aspectRatio="16 / 9"
            autoPlay
            className="hfilm__player"
          />
        ) : (
          <div
            className="hfilm__cover"
            style={ready && film.poster ? { backgroundImage: `url("${film.poster}")` } : undefined}
            data-poster={ready && film.poster ? "image" : "drawn"}
          >
            <p className="hfilm__title">
              Как устроена <span className="hfilm__brand">Alpha Trade Academy</span>
            </p>
            <p className="hfilm__line">
              {ready
                ? "Путь, собственное решение, практика и разбор — за несколько минут."
                : "Готовим короткий фильм о том, как здесь устроено обучение: путь, собственное решение, практика и разбор."}
            </p>
            <ol className="hfilm__route" aria-hidden="true">
              {CYCLE.map((step) => (
                <li key={step}>
                  <i />
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            {ready ? (
              <button
                type="button"
                className="hfilm__play"
                aria-label={`Смотреть фильм «${FILM_TITLE}»`}
                onClick={() => setWatching(true)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                  <path d="M8 5.5v13l11-6.5z" />
                </svg>
              </button>
            ) : null}
          </div>
        )}
      </div>
    </figure>
  );
}
