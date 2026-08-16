/**
 * App-level loading. Field-shaped, because the first thing every authenticated
 * route shows is a statement and a control — a generic spinner would tell the
 * learner nothing about what is arriving, and identical skeletons everywhere is
 * exactly the pattern the art direction rejects.
 *
 * Nothing here implies progress state: the skeleton has no numbers, so a slow
 * load can never appear to change the learner's position.
 */
import "@/features/academy-experience/experience.css";

export default function Loading() {
  return (
    <div className="ax" aria-busy="true" aria-label="Загрузка">
      <div className="ax-fieldwrap">
        <div className="ax-field" data-posture="waiting">
          <div className="ax-skel ax-skel--line" style={{ width: 220 }} />
          <div className="ax-skel ax-skel--statement" />
          <div className="ax-skel ax-skel--line" style={{ width: "60%" }} />
          <div className="ax-skel ax-skel--line" style={{ width: "45%" }} />
          <div className="ax-skel ax-skel--cta" />
        </div>
      </div>
    </div>
  );
}
