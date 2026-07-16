"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { CurriculumLevel } from "@/domain/curriculum";
import { levelCodeFor } from "@/features/lesson/model/lesson";
import { formatThresholdUsd } from "@/domain/curriculum";
import { getModuleForLevel, getNextCheckpoint } from "@/data/curriculum/fixture";
import {
  levelVisualState,
  lockedReason,
  stateLabel,
  type PathProgress,
} from "@/features/path/model/path-state";

/**
 * Contextual level detail (Phase D2A, presentation refined in D2A-R1).
 *
 * Desktop/tablet: a plane anchored to the selected node — the map stays visible
 * and a leader line runs from the node to this panel's boundary edge, so the
 * node is visibly the source of the context (not a floating SaaS card, not a
 * centred modal, not an app sidebar). Mobile: an OPAQUE sheet above the bottom
 * navigation over a soft scrim — the route beneath must never read through it.
 *
 * Content hierarchy: level → state → requirement → next boundary → action.
 * Locked levels get an explainer and never reveal lesson content beyond the
 * brief. No user balance, no Pocket CTA — ever.
 */
export function PathDetailLayer({
  level,
  progress,
  onClose,
}: {
  level: CurriculumLevel;
  progress: PathProgress;
  onClose: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const state = levelVisualState(level, progress);
  const mod = getModuleForLevel(level.number);
  const isCheckpoint = level.kind === "checkpoint";
  const cp = level.checkpoint ?? getNextCheckpoint(level.number);

  // Move reading focus to the layer when it opens / the level changes.
  useEffect(() => {
    headingRef.current?.focus();
  }, [level.number]);

  const locked = state === "locked";
  const stateClass =
    state === "checkpoint-ahead" || state === "checkpoint-current"
      ? "cold"
      : locked
        ? "mut"
        : "";

  return (
    <aside className="path-detail" aria-label={`Уровень ${level.number} — детали`}>
      {/* the boundary edge that the node's leader line lands on */}
      <span className="d-edge" aria-hidden="true" />
      <button type="button" className="d-close" onClick={onClose} aria-label="Закрыть детали уровня">
        <span aria-hidden="true">✕</span>
      </button>
      <p className="d-eyebrow">
        Уровень {level.number} · Модуль {mod.index} «{mod.title}»
      </p>
      <h2 tabIndex={-1} ref={headingRef}>
        {isCheckpoint ? `Контрольная точка · Уровень ${level.number}` : level.title}
      </h2>
      <p className={`d-state ${stateClass}`}>Состояние: {stateLabel(state)}</p>

      {locked ? (
        <div className="d-sec">
          <p className="d-k">Почему закрыт</p>
          <ul>
            <li>{lockedReason(level, progress)}</li>
            <li>Уровни открываются строго по порядку — перепрыгнуть нельзя.</li>
          </ul>
          <p className="d-note">Содержание уровня откроется вместе с доступом.</p>
        </div>
      ) : (
        <div className="d-sec">
          <p className="d-k">{isCheckpoint ? "Условие" : "Что требуется"}</p>
          <ul>
            {isCheckpoint ? (
              <li>
                Баланс Pocket от <b>{formatThresholdUsd(cp.thresholdUsd)}</b>
              </li>
            ) : (
              <>
                {level.kind === "video-test" && <li>Видео-урок и тест</li>}
                {level.kind === "task" && <li>Задание</li>}
                {level.kind === "report" && <li>Structured report</li>}
                {level.kind === "practical" && <li>Практическое задание</li>}
                {level.artifact && (
                  <li>
                    Артефакт: <b>{level.artifact}</b>
                  </li>
                )}
                {level.mentorReview && <li>Обязательная проверка ментора</li>}
              </>
            )}
          </ul>
          {isCheckpoint && (
            <p className="d-note">
              Учитывается только подтверждённый реальный баланс. Demo не учитывается.
            </p>
          )}
        </div>
      )}

      {isCheckpoint && (
        <div className="d-sec">
          <p className="d-k">За контрольной точкой</p>
          <ul>
            <li>
              Ранг: <b>{cp.rank.label}</b>
            </li>
            {cp.toolUnlock && (
              <li>
                Инструмент: <b>{cp.toolUnlock.name}</b>
              </li>
            )}
            {cp.communityUnlock && (
              <li>
                Канал сообщества: <b>{cp.communityUnlock.name}</b>
              </li>
            )}
          </ul>
        </div>
      )}

      {!isCheckpoint && !locked && (
        <div className="d-sec">
          <p className="d-k">Впереди</p>
          <ul>
            <li>
              Контрольная точка · Уровень {cp.level} —{" "}
              <b>баланс Pocket от {formatThresholdUsd(cp.thresholdUsd)}</b>
            </li>
          </ul>
        </div>
      )}

      <div className="d-actions">
        <DetailAction level={level} state={state} />
      </div>
    </aside>
  );
}

/**
 * Primary action for the selected level.
 *
 * Lesson destinations are real links since D2B built the lesson route; the
 * checkpoint ones stay development-safe no-op buttons (no 404, no fake success —
 * see DD-219). A locked level never gets a link into an unreachable lesson.
 */
function DetailAction({
  level,
  state,
}: {
  level: CurriculumLevel;
  state: ReturnType<typeof levelVisualState>;
}) {
  const href = `/lessons/${levelCodeFor(level.number)}`;

  switch (state) {
    case "current":
      return (
        <Link href={href} className="d-cta">
          Продолжить урок
        </Link>
      );
    case "checkpoint-current":
      return <button type="button" className="d-cta">Проверить выполнение</button>;
    case "completed":
      return (
        <Link href={href} className="d-cta quiet">
          Повторить урок
        </Link>
      );
    case "checkpoint-completed":
      return <button type="button" className="d-cta quiet">Открыть итог точки</button>;
    case "available":
      return (
        <p className="d-note">Станет доступен после текущего уровня — вернись к нему на карте.</p>
      );
    default:
      return (
        <p className="d-note">
          Уровень {level.number} откроется по мере продвижения по пути.
        </p>
      );
  }
}
