import type { CheckpointModel } from "@/domain/home";
import { ProvisionalRankMark } from "@/components/rank/provisional-rank-mark";

/** A markup motif for the tool unlock (framed marked level — not an ascending chart). */
function ToolGlyph() {
  return (
    <svg className="tool-glyph" width={40} height={40} viewBox="0 0 62 62" aria-hidden="true">
      <rect x="10" y="14" width="42" height="34" rx="4" fill="none" stroke="var(--gate-boundary)" strokeWidth="2" />
      <line x1="16" y1="31" x2="46" y2="31" stroke="var(--signal-active)" strokeWidth="2" strokeDasharray="1.5 3" />
      <circle cx="35" cy="31" r="2.8" fill="var(--signal-active)" />
      <line x1="27" y1="20" x2="41" y2="42" stroke="var(--signal-active)" strokeWidth="1.6" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}

/**
 * The far side of the gate: what opens beyond it. Rank and tool are two SEPARATE
 * results sharing one structural column with a minimal divider — not two pills/cards.
 */
export function CheckpointOutcome({ checkpoint }: { checkpoint: CheckpointModel }) {
  return (
    <div className="gate-far">
      <p className="lbl">За границей · что откроется</p>
      <div className="results">
        <div className="result">
          <ProvisionalRankMark size={40} />
          <div className="result-txt">
            <span className="k">Следующий ранг</span>
            <span className="v">{checkpoint.nextRankLabel}</span>
          </div>
        </div>
        <div className="result-div" aria-hidden="true" />
        <div className="result">
          <ToolGlyph />
          <div className="result-txt">
            <span className="k">Новый инструмент</span>
            <span className="v">{checkpoint.unlockToolName}</span>
          </div>
        </div>
      </div>
      <p className="svc mut" style={{ marginTop: 20 }}>
        …и следующий модуль пути
      </p>
    </div>
  );
}
