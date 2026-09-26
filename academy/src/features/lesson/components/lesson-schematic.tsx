/**
 * The lesson's visual frame (Phase D2B) — an abstract educational schematic for
 * «Поддержка и сопротивление».
 *
 * Deliberately NOT a decorative candlestick chart and NOT market data: there are
 * no prices, no axis values, no instrument, no time, no buy/sell markers and no
 * outcome. It shows only the idea the lesson teaches — two BANDS (zones, not
 * lines) and where the path reacted to them. The bands are the subject and carry
 * the visual weight; the path is deliberately quiet connective tissue, so the
 * frame cannot be read as a chart showing a result (D2B visual QA, finding 4).
 *
 * The viewBox is 3:1 and scales with preserveAspectRatio="meet", so the drawing
 * is never stretched at any viewport; the frame's own navy shows through the
 * letterbox, making the fit invisible (finding 3).
 *
 * Fully decorative for assistive tech (aria-hidden): every fact it carries is
 * also present as real text — the chapter line, the legend and the outline.
 * `focus` follows the playhead's section so the frame is functional, not motion
 * for its own sake.
 */
export type SchematicFocus =
  | "support"
  | "resistance"
  | "zones"
  | "repeat"
  | "confirmation"
  | "none";

/** Band geometry — zones are ranges, never a single line. */
const RES = { top: 70, height: 38 };
const SUP = { top: 192, height: 38 };

/** Reaction points where the path met a zone — the "repeat reaction" idea. */
const REACTIONS = [
  { x: 100, y: 211 },
  { x: 250, y: 89 },
  { x: 420, y: 211 },
  { x: 640, y: 89 },
];

export function LessonSchematic({ focus = "none" }: { focus?: SchematicFocus }) {
  const on = (...keys: SchematicFocus[]) => (keys.includes(focus) ? "on" : "");

  return (
    <svg
      className="ls-schematic"
      viewBox="0 0 900 300"
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
      focusable="false"
    >
      <g className="ls-grid">
        {[40, 150, 260].map((y) => (
          <line key={y} x1="0" y1={y} x2="900" y2={y} />
        ))}
        {[225, 450, 675].map((x) => (
          <line key={x} x1={x} y1="0" x2={x} y2="300" />
        ))}
      </g>

      {/* resistance zone — a band, never a single line */}
      <g className={`ls-zone ls-zone-res ${on("resistance", "zones")}`}>
        <rect x="0" y={RES.top} width="900" height={RES.height} />
        <line x1="0" y1={RES.top} x2="900" y2={RES.top} />
        <line x1="0" y1={RES.top + RES.height} x2="900" y2={RES.top + RES.height} />
      </g>

      {/* support zone */}
      <g className={`ls-zone ls-zone-sup ${on("support", "zones")}`}>
        <rect x="0" y={SUP.top} width="900" height={SUP.height} />
        <line x1="0" y1={SUP.top} x2="900" y2={SUP.top} />
        <line x1="0" y1={SUP.top + SUP.height} x2="900" y2={SUP.top + SUP.height} />
      </g>

      {/* the path: structure only — quiet, and never a promised outcome */}
      <polyline
        className="ls-path"
        points="0,150 100,211 175,140 250,89 335,150 420,211 530,150 640,89 760,170 900,158"
      />

      {/* where the path reacted to a zone */}
      <g className={`ls-react ${on("repeat")}`}>
        {REACTIONS.map((p) => (
          <circle key={`${p.x}-${p.y}`} cx={p.x} cy={p.y} r="6" />
        ))}
      </g>

      {/* the last approach — the one that still needs confirmation */}
      <g className={`ls-pending ${on("confirmation")}`}>
        <circle cx="640" cy="89" r="13" />
        <line x1="640" y1="89" x2="640" y2="300" strokeDasharray="4 7" />
      </g>
    </svg>
  );
}

/** Maps a lesson section id to what the frame should emphasise. */
export function focusForSection(sectionId: string | null): SchematicFocus {
  switch (sectionId) {
    case "section.018.support":
      return "support";
    case "section.018.resistance":
      return "resistance";
    case "section.018.zones":
      return "zones";
    case "section.018.repeat":
      return "repeat";
    case "section.018.confirmation":
      return "confirmation";
    default:
      return "none";
  }
}
