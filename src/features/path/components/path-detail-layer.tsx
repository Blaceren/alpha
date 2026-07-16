"use client";

import { useEffect, useRef } from "react";
import type { CurriculumLevel } from "@/domain/curriculum";
import { formatThresholdUsd } from "@/domain/curriculum";
import { getModuleForLevel, getNextCheckpoint } from "@/data/curriculum/fixture";
import {
  levelVisualState,
  lockedReason,
  stateLabel,
  type PathProgress,
} from "@/features/path/model/path-state";

/**
 * Contextual level detail. Desktop/tablet: an anchored side plane next to the
 * map (the map stays visible — not a centred modal). Mobile: a fixed sheet that
 * sits above the bottom navigation. Locked levels get an explainer (why locked,
 * what step is required) and never reveal lesson content beyond the brief.
 * No user balance, no Pocket CTA — ever.
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
      <button type="button" className="d-close" onClick={onClose} aria-label="Закрыть детали уровня">
        ✕
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

/** Development-safe primary action (no 404, no fake success — see DD-219). */
function DetailAction({
  level,
  state,
}: {
  level: CurriculumLevel;
  state: ReturnType<typeof levelVisualState>;
}) {
  switch (state) {
    case "current":
      return <button type="button" className="d-cta">Продолжить урок</button>;
    case "checkpoint-current":
      return <button type="button" className="d-cta">Проверить выполнение</button>;
    case "completed":
      return <button type="button" className="d-cta quiet">Повторить урок</button>;
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
