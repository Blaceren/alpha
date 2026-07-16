import Link from "next/link";
import type {
  LibraryLevelRow,
  LibrarySelectedModule,
} from "@/features/lessons-library/model/lessons-library-model";

/**
 * The opened module: its levels as INDEX ROWS, never a card grid (Concept B).
 *
 * Status is always a word, so state never rests on colour. The current lesson is
 * raised by type + a vertical accent + a background wash — not by becoming a
 * bigger card. The checkpoint is separated by a thin structural rule and states
 * only its target and what it opens: no balance, no remainder, no progress
 * percentage, no Pocket link (DD-259).
 */
function LevelRow({ level }: { level: LibraryLevelRow }) {
  const meta = (
    <span className="lib-row-k">
      <span>{level.kindLabel}</span>
      {level.durationLabel && (
        <>
          <i className="sep" aria-hidden="true" />
          <span className="mono">{level.durationLabel}</span>
        </>
      )}
      {level.artifact && (
        <>
          <i className="sep" aria-hidden="true" />
          <span>
            Артефакт: <b>{level.artifact}</b>
          </span>
        </>
      )}
      {level.mentorReview && (
        <>
          <i className="sep" aria-hidden="true" />
          <span>Проверка ментора</span>
        </>
      )}
    </span>
  );

  // ---- checkpoint: a module boundary, not a lesson and not an advert ----
  if (level.state === "checkpoint") {
    return (
      <li className="lib-row is-checkpoint">
        <div className="lib-row-in">
          <span className="lib-row-n mono" aria-hidden="true">
            {level.number}
          </span>
          <span className="lib-row-body">
            <span className="lib-row-t">{level.title}</span>
            {level.checkpoint && (
              <>
                <span className="lib-row-k">
                  Условие: <b>{level.checkpoint.requirement}</b>
                </span>
                <span className="lib-row-rw">
                  <span className="lib-row-rw-k">Открывает</span>
                  {level.checkpoint.rewards.map((reward) => (
                    <span className="lib-rw" key={reward}>
                      {reward}
                    </span>
                  ))}
                </span>
              </>
            )}
          </span>
          <span className="lib-row-s">{level.statusLabel}</span>
        </div>
      </li>
    );
  }

  const body = (
    <>
      <span className="lib-row-n mono" aria-hidden="true">
        {level.number}
      </span>
      <span className="lib-row-body">
        <span className="lib-row-t">{level.title}</span>
        {meta}
      </span>
      {/* No dot leader here, deliberately: the leader belongs to the 20-module
          contents, where it spans a long gap. Inside a two-line level row it
          aligned to the wrong baseline and pushed the page towards reading like
          a spec sheet (D2C-A review, minor #11). */}
      <span className="lib-row-s">
        {level.statusLabel}
        {level.actionLabel && <b className="lib-row-a"> · {level.actionLabel}</b>}
      </span>
      <span className="sr-only">{`Уровень ${level.number}. ${level.statusLabel}.`}</span>
    </>
  );

  // A locked level is not a dead link and not a disabled button: it is text that
  // says when it opens.
  if (!level.href) {
    return (
      <li className={`lib-row is-${level.state}`}>
        <div className="lib-row-in">{body}</div>
      </li>
    );
  }

  return (
    <li className={`lib-row is-${level.state}`}>
      <Link
        className="lib-row-in"
        href={level.href}
        aria-current={level.state === "current" ? "true" : undefined}
      >
        {body}
      </Link>
    </li>
  );
}

export function LibraryModuleContent({ module: mod }: { module: LibrarySelectedModule }) {
  return (
    <section className="lib-open" aria-labelledby="lib-open-h">
      <header className="lib-open-head">
        <p className="lib-open-k">
          <span className="mono">Модуль {String(mod.index).padStart(2, "0")}</span>
          {" · "}
          <span>
            уровни {mod.startLevel}–{mod.endLevel}
          </span>
          {" · "}
          <span>
            пройдено <b className="mono">{mod.completedCount}</b> из{" "}
            <span className="mono">{mod.totalCount}</span>
          </span>
        </p>
        <h2 className="lib-open-h" id="lib-open-h">
          {mod.title}
        </h2>
        <p className="lib-open-d">{mod.description}</p>
      </header>

      <ol className="lib-rows" aria-label={`Уровни модуля «${mod.title}»`}>
        {mod.levels.map((level) => (
          <LevelRow key={level.code} level={level} />
        ))}
      </ol>

      {/* An honest empty state: a module the sequence has not reached has no
          action at all — we say so instead of showing a dead control. */}
      {!mod.hasAnyAction && (
        <p className="lib-empty">
          Уровни этого модуля пока закрыты последовательностью. Они откроются по мере прохождения
          предыдущих модулей.
        </p>
      )}
    </section>
  );
}
