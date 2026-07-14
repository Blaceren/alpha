import type { CheckpointModel } from "@/domain/home";

/**
 * On the Active screen the future checkpoint reads as a distant structural
 * boundary (a small gate fragment) with its outcome — not a text line, not pills.
 */
export function FutureCheckpointPreview({ checkpoint }: { checkpoint: CheckpointModel }) {
  return (
    <aside className="fcp" aria-label={`Впереди: контрольная точка, уровень ${checkpoint.levelIndex}`}>
      <svg width={44} height={150} viewBox="0 0 44 150" aria-hidden="true">
        <line x1="14" y1="6" x2="14" y2="144" stroke="var(--gate-boundary)" strokeWidth="2" opacity="0.85" />
        <line x1="26" y1="22" x2="26" y2="128" stroke="var(--gate-boundary)" strokeWidth="2" opacity="0.5" />
        <ellipse cx="15" cy="75" rx="8" ry="46" fill="none" stroke="var(--signal-active)" strokeWidth="1.3" opacity="0.6" />
      </svg>
      <div className="txt">
        <p className="svc mut" style={{ letterSpacing: ".5px", margin: 0 }}>
          ВПЕРЕДИ · ГРАНИЦА
        </p>
        <p className="cp">Контрольная точка · Уровень {checkpoint.levelIndex}</p>
        <p className="res">
          Следующий ранг: <b>{checkpoint.nextRankLabel}</b>
          <br />
          Откроется: <b>{checkpoint.unlockToolName}</b>
        </p>
      </div>
    </aside>
  );
}
