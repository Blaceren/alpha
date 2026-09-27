import Link from "next/link";
import type { ToolView } from "@/features/tools/model/tools-projection";
import "@/features/tools-fidelity/tools-fidelity.css";
import "@/features/tools-fidelity/tools-fidelity-safety.css";

/**
 * TOOLS — the frozen register and capability pages, on canonical progress.
 *
 * VISUAL AUTHORITY: ToolsATA @ b65f309aadc2a46cb24d8d22c577838459006371 — the
 * Phase-2 foundation, the Phase-3 primitives (`t-entry`, `t-identity`,
 * `t-state`, `t-caveat`) and the Phase-4 page composition.
 *
 * DATA AUTHORITY: the product. Unlock is decided in exactly ONE place — the
 * canonical resolver behind `projectTools` — and nothing here compares a level,
 * hardcodes a milestone or reads a query to bypass a lock. These components take
 * `ToolView`s and render them.
 *
 * WHAT THE FROZEN ARTIFACT CARRIES THAT THE PRODUCT DOES NOT:
 *
 *   * THE OWNED-WORK TRACE — a line of the learner's own writing under a
 *     register row. It is real content, and the hub has none: the journal lives
 *     in browser-local storage, which the server cannot read, and inventing a
 *     line would be putting words in the learner's mouth. The rule stays in the
 *     stylesheet; the row simply ends at its condition line.
 *
 *   * THE POPULATED TOOL PAGES — journal records, playbook sections, pause
 *     instances, a filled result region. Those are fixture content for tools
 *     that do not exist in this build, and rendering them would be the one
 *     thing the Tools contract forbids by name: claiming an unimplemented tool
 *     is operational. An unimplemented tool gets the frozen NOT-ENTERABLE page,
 *     which is the honest member of the same design system.
 *
 *   * SOURCE_UNAVAILABLE and INSUFFICIENT_RECORDS conditions. Both describe a
 *     data source no tool in this build has. They are not rendered because they
 *     cannot currently be true.
 */

/** Frozen copy, verbatim. */
export const TOOLS_COPY = {
  registerTitle: "Инструменты",
  /* The lead has described the catalogue twice now, and both times it was
     describing a list that included seventeen tools nobody can open. The
     register no longer lists them, so the lead no longer has two halves to
     reconcile: it says what these tools are and what governs reaching them. */
  registerLead: "Рабочие инструменты ATA. Доступ открывается по мере продвижения по пути.",
  back: "Инструменты",
  lockedLead: "Этот инструмент ещё не открыт.",
  lockedBody: (level: number) => `Он станет доступен на уровне ${level} и останется доступным дальше.`,
  lockedProvenanceLabel: "Условие доступа",
  lockedProvenance: (level: number) => `Уровень ${level}`,
  /* An unbuilt tool says the same thing here as it does in the register, and
     for the same reason: a deep link must not make the promise the row no
     longer makes.

     It also promises nothing beyond that. The earlier copy said the working
     surface would appear and that work would continue on this page — a date and
     a guarantee the build cannot give — and «поверхность» is our word for it,
     not the learner's. Short status headings carry no full stop. */
  roadmapLead: "В разработке",
  roadmapBody: "Инструмент ещё не выпущен.",
  accessLabel: "Доступ",
  access: "Открыт и сохраняется",
  forward: "Работа продолжится на этой же странице.",
  notFoundLead: "Такого инструмента нет.",
  notFoundBody: "Проверьте ссылку — возможно, инструмент называется иначе.",
  notFoundAction: "К инструментам",
  emptyLead: "Инструменты пока не открыты.",
  emptyBody: "Каждый инструмент открывается своим уровнем и остаётся доступным дальше.",
} as const;

/**
 * THE REGISTER — the one canonical /tools anatomy.
 *
 * Required: identity · purpose · condition. Optional: provenance · action.
 * The condition line is always last and always present: that fixed locus is what
 * lets a learner read the register without re-learning where to look each time.
 *
 * No search, no filters, no favourites, no recents, no categories, no ranking.
 */
export function ToolsRegister({ tools }: { tools: ToolView[] }) {
  return (
    <div className="tls">
      <div className="t-surface p4">
        <h1 className="t-page-title">{TOOLS_COPY.registerTitle}</h1>
        <p className="t-lead">{TOOLS_COPY.registerLead}</p>
        {tools.length === 0 ? (
          <StateMessage truth={TOOLS_COPY.emptyLead} meaning={TOOLS_COPY.emptyBody} />
        ) : (
          <div className="t-register">
            {tools.map((tool) => (
              <RegisterEntry key={tool.code} tool={tool} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RegisterEntry({ tool }: { tool: ToolView }) {
  /* The action appears only where there is something to open. A locked tool and
     an unlocked-but-unbuilt one both offer none — which is the frozen rule, and
     is also the only honest thing to show.

     IT IS THE ACTION, NOT THE ROW, THAT NAVIGATES. `.t-entry` is a two-column
     grid, so wrapping the row in a link would leave the grid one child and
     collapse the anatomy; and a whole-row target would make a locked row look
     like an open one. The accessible name carries the tool, because "Открыть"
     repeated names nothing. */
  const action =
    tool.available && tool.href ? (
      <Link
        className="t-entry-action tls-target"
        href={tool.href}
        aria-label={`${tool.ctaLabel}: ${tool.title}`}
      >
        {tool.ctaLabel}
      </Link>
    ) : null;

  /*
   * THREE STATES, AND THE ROW SAYS WHICH ONE IT IS.
   *
   * `unlocked` alone cannot express the register: a tool whose gate is passed
   * but whose surface does not exist is neither locked nor open, and it used to
   * render identically to a working one. These are class names only — they add
   * no text, no attribute the contract cares about and no element, so the
   * class-stripped tree is byte-for-byte what it was.
   */
  return (
    <article
      className={`t-entry t-entry--${!tool.unlocked ? "locked" : tool.available ? "open" : "roadmap"}`}
    >
      <div className="t-entry-provenance" aria-label={`Уровень ${tool.unlockLevel}`}>
        L{tool.unlockLevel}
      </div>
      <div className="t-entry-body">
        <div className="t-entry-head">
          <h2 className="t-entry-name">{tool.title}</h2>
          {action}
        </div>
        <p className="t-entry-purpose">{tool.description}</p>
        {/* The condition line is always last and always present: that fixed
            locus is what lets a learner read nineteen heterogeneous rows
            without re-learning where to look each time. */}
        <p className="t-entry-condition">{tool.statusLabel}</p>
        {/* PROGRESS, BENEATH READINESS, AND ONLY WHERE THEY CAN DISAGREE.
            An unbuilt tool has two facts to report and they move independently:
            reaching the gate changes this line and nothing else on the row. */}
        {tool.requirementLabel ? (
          <p className="t-entry-requirement">{tool.requirementLabel}</p>
        ) : null}
      </div>
    </article>
  );
}

/**
 * The single grammar for every held state, and its structure is fixed:
 * STATE TRUTH → WHAT IT MEANS → (what can be done). Nothing about a held state
 * is expressed by colour.
 */
export function StateMessage({
  truth,
  meaning,
  action,
}: {
  truth: string;
  meaning: string;
  action?: { label: string; href: string };
}) {
  return (
    <>
      <div className="t-state" role="status">
        <p className="t-state-truth">{truth}</p>
        <p className="t-state-meaning">{meaning}</p>
      </div>
      {action ? (
        <Link className="t-action" href={action.href}>
          {action.label}
        </Link>
      ) : null}
    </>
  );
}

export function ReturnLink() {
  return (
    <Link className="t-return" href="/tools">
      {TOOLS_COPY.back}
    </Link>
  );
}

export function CapabilityHeader({ tool, workNote }: { tool: ToolView; workNote?: string }) {
  return (
    <header className="t-identity">
      <h1>{tool.title}</h1>
      <p className="t-purpose">{tool.description}</p>
      {workNote ? <p className="t-worknote">{workNote}</p> : null}
    </header>
  );
}

/**
 * LOCKED and NOT-ENTERABLE differ STRUCTURALLY, never by colour.
 *
 * Locked states a CONDITION that will be met later, and names it. Not-enterable
 * states an ACCESS FACT that already holds, and adds a forward line — the
 * learner has the tool, the surface is what is missing.
 */
export function ToolLockedPage({ tool }: { tool: ToolView }) {
  /* An unbuilt tool is not "not open yet" — it is not built, at every level,
     and saying otherwise here would restore the promise the register dropped.
     The gate is still reported, as the second and separate fact it is. */
  const roadmap = !tool.implemented;
  return (
    <div className="tls">
      <div className="t-surface t-surface--prose p4">
        <ReturnLink />
        <CapabilityHeader tool={tool} />
        <StateMessage
          truth={roadmap ? TOOLS_COPY.roadmapLead : TOOLS_COPY.lockedLead}
          meaning={roadmap ? TOOLS_COPY.roadmapBody : TOOLS_COPY.lockedBody(tool.unlockLevel)}
        />
        <div className="p4-state-fact">
          {roadmap ? (
            /* The same sentence the register uses, so the two never drift. */
            <div className="p4-state-fact-value">{tool.requirementLabel}</div>
          ) : (
            <>
              <div className="p4-state-fact-key">{TOOLS_COPY.lockedProvenanceLabel}</div>
              <div className="p4-state-fact-value">
                {TOOLS_COPY.lockedProvenance(tool.unlockLevel)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function ToolNotEnterablePage({ tool }: { tool: ToolView }) {
  /* Reached when the gate IS passed and the surface still does not exist —
     which is the same two facts as before the gate, with one of them settled.
     So it is the same page, and says the same thing. */
  return (
    <div className="tls">
      <div className="t-surface t-surface--prose p4">
        <ReturnLink />
        <CapabilityHeader tool={tool} />
        <StateMessage truth={TOOLS_COPY.roadmapLead} meaning={TOOLS_COPY.roadmapBody} />
        <div className="p4-state-fact">
          <div className="p4-state-fact-value">{tool.requirementLabel}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * An unknown code must NOT masquerade as a canonical capability: no title, no
 * level, no purpose, no capability header at all. Anything else would let a
 * made-up URL invent a tool.
 */
export function ToolNotFoundPage() {
  /* THE TRUTH LINE IS THIS PAGE'S HEADING, NOT A PARAGRAPH.
   *
   * It used to come from `StateMessage`, which renders every state's truth line
   * as a <p>. That is right where it is used — those states sit under a heading
   * the tool page already has. This page has no other heading, so the document
   * had none at all and a screen reader arrived with no entry point.
   *
   * `StateMessage` is deliberately NOT changed: it also serves the empty, locked
   * and roadmap states, and giving it a configurable tag would let a second <h1>
   * appear on a page that already has one. What follows is that component's own
   * structure with one element swapped, carrying the same classes — `.t-state-truth`
   * sets its own size and margin, so nothing about the appearance moves. */
  return (
    <div className="tls">
      <div className="t-surface t-surface--prose p4">
        <ReturnLink />
        <div className="t-state" role="status">
          <h1 className="t-state-truth">{TOOLS_COPY.notFoundLead}</h1>
          <p className="t-state-meaning">{TOOLS_COPY.notFoundBody}</p>
        </div>
        <Link className="t-action" href="/tools">
          {TOOLS_COPY.notFoundAction}
        </Link>
      </div>
    </div>
  );
}

/**
 * The frame around a tool that really is built — and nothing more than a frame.
 *
 * IT USED TO ADD A SECOND HEADER. Both built workspaces open with a complete
 * one of their own: a return link, the level marker, the `h1` and the note. The
 * frame added its own return link, its own `h1` and the description on top, so
 * the page said "Инструменты" twice, "Risk Calculator" twice, carried two `h1`s
 * — and on a 390px screen spent most of the first screen introducing itself
 * twice before the first input.
 *
 * The state pages keep the outer header, because they have no inner one; a
 * workspace does, so the frame steps back and lets it speak. `tool` stays in
 * the signature: the frame is the place a per-tool wrapper would belong, and
 * removing the parameter would make adding one look like new API.
 */
export function ToolWorkFrame({ tool, children }: { tool: ToolView; children: React.ReactNode }) {
  void tool;
  return (
    <div className="tls">
      <div className="t-surface p4">{children}</div>
    </div>
  );
}
