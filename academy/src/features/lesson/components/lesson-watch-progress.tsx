import { formatDuration } from "@/features/lesson/model/lesson";

/**
 * Verified watch progress (Phase D2B).
 *
 * Reports maxVerifiedWatchedPosition — NOT the playhead — because that is what
 * the assessment gate reads. The threshold is drawn on the track so the 50%
 * condition is a visible place on the bar, not just a sentence, and the state is
 * stated in words as well (never colour alone).
 */
export function LessonWatchProgress({
  percent,
  thresholdPercent,
  durationSeconds,
  unlocked,
}: {
  percent: number;
  thresholdPercent: number;
  durationSeconds: number;
  unlocked: boolean;
}) {
  const rounded = Math.floor(percent);
  const watchedSeconds = Math.floor((percent / 100) * durationSeconds);
  const label = unlocked
    ? "Просмотрено достаточно, чтобы открыть проверку"
    : `До проверки понимания — ещё ${Math.max(0, thresholdPercent - rounded)}% видео`;

  return (
    <div className="lw">
      <div className="lw-top">
        <p className="lw-title">Просмотрено</p>
        <p className="lw-val">
          <b>{rounded}%</b>
          <span className="lw-time">
            {formatDuration(watchedSeconds)} из {formatDuration(durationSeconds)}
          </span>
        </p>
      </div>

      <div
        className={`lw-track ${unlocked ? "open" : ""}`}
        role="progressbar"
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`Просмотрено ${rounded}% видео`}
        aria-label="Подтверждённый просмотр видео"
      >
        <span className="lw-fill" style={{ width: `${percent}%` }} />
        <span className="lw-mark" style={{ left: `${thresholdPercent}%` }} aria-hidden="true" />
      </div>

      <p className="lw-note">
        <span className="lw-marklabel" aria-hidden="true" />
        {label}. Засчитывается только просмотренное — перемотка вперёд прогресс не добавляет.
      </p>
    </div>
  );
}
