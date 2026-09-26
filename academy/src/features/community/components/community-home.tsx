"use client";

/**
 * Сообщество (/community) — Community Home.
 *
 * ART DIRECTION: Direction B «Порог», as selected at the D5 gate. Five UNEQUAL
 * plates whose MATERIAL says open / readable / locked, and the open one carries
 * real discussions inside it.
 *
 * WHY THE OPEN PLATE CONTAINS CONTENT, WHICH IS THE WHOLE DESIGN. A channel
 * list answers "what rooms exist". This answers "what is being asked where you
 * can answer it", because in PREPROD four of the five spaces are closed for
 * every learner and a list of four locked rooms plus one open one is a dead
 * end. The discussions inside the open plate are set LARGER than the space
 * titles below it: content outranks architecture.
 *
 * ACCESS IS NOT DECIDED HERE. `canRead`, `canWrite`, `lockedReason` and
 * `requiredModuleNumber` all arrive resolved from the single Backend owner.
 * This file contains no level number, no threshold and no comparison.
 */
import * as React from "react";
import Link from "next/link";
import {
  fetchCommunityOverview,
  type CommunityOverview,
  type CommunitySpaceSummary,
  type CommunityDiscussionSummary,
} from "@/lib/community/community-client";
import { AuthorChip, CommunitySkeleton, ErrorNote, errorText, formatWhen } from "./community-atoms";

/**
 * The requirement, in the learner's vocabulary.
 *
 * «Откроется после завершения модуля 4», never «недостаточный уровень» — the
 * V2 curriculum is the real owner, so the sentence names what the learner
 * actually has to finish. When the server could not name a module (it fails
 * closed rather than guessing), the copy stays honest instead of inventing one.
 */
function requirementText(space: CommunitySpaceSummary): string {
  if (space.lockedReason === "not_enrolled") {
    return "Откроется после начала программы";
  }
  if (space.requiredModuleNumber !== null) {
    return `Откроется после завершения модуля ${space.requiredModuleNumber}`;
  }
  return "Откроется по мере прохождения программы";
}

function DiscussionPreview({ discussion }: { discussion: CommunityDiscussionSummary }) {
  return (
    <li className="cm-preview__item">
      <Link className="cm-preview__link" href={`/community/d/${discussion.id}`}>
        <p className={discussion.isRemoved ? "cm-preview__title cm-list__title--removed" : "cm-preview__title"}>
          {discussion.title}
        </p>
        <span className="cm-preview__meta">
          <AuthorChip author={discussion.author} />
          <span>
            ·{" "}
            {discussion.replyCount === 0
              ? "пока без ответов"
              : `${discussion.replyCount} ${pluralAnswers(discussion.replyCount)}`}
          </span>
          <span>· {formatWhen(discussion.lastActivityAt)}</span>
        </span>
      </Link>
    </li>
  );
}

/** Russian needs three forms. Getting this wrong reads as machine output. */
export function pluralAnswers(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "ответ";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "ответа";
  return "ответов";
}

/**
 * An accessible space.
 *
 * EVERY plate a learner can read carries its real discussions — including a
 * read-only one. That is not a detail: below level 4 the entry space is a
 * learner's ONLY accessible space, and rendering it as a bare title with a
 * "можно читать" chip would put the dead end straight back where the plate
 * design removed it. The MATERIAL still separates the two states (lit edge and
 * «открыто» versus flat and «можно читать»), and the difference in what the
 * learner may DO shows in the call to action, not in whether they get content.
 */
function AccessiblePlate({
  space,
  discussions,
}: {
  space: CommunitySpaceSummary;
  discussions: CommunityDiscussionSummary[];
}) {
  const canWrite = space.canWrite;
  return (
    <section
      className={canWrite ? "cm-plate cm-plate--open" : "cm-plate cm-plate--readable"}
      aria-labelledby={`sp-${space.code}`}
    >
      <div className="cm-plate__top">
        <h2 className="cm-plate__title" id={`sp-${space.code}`}>
          {space.title}
        </h2>
        <span className="cm-plate__state">{canWrite ? "открыто" : "можно читать"}</span>
      </div>
      <p className="cm-plate__purpose">{space.purpose}</p>

      {!canWrite ? (
        <p className="cm-plate__requirement">
          {space.requiredModuleNumber !== null
            ? `Задавать вопросы можно после завершения модуля ${space.requiredModuleNumber}`
            : "Задавать вопросы можно по мере прохождения программы"}
        </p>
      ) : null}

      {discussions.length > 0 ? (
        <ul className="cm-preview">
          {discussions.map((discussion) => (
            <DiscussionPreview key={discussion.id} discussion={discussion} />
          ))}
        </ul>
      ) : (
        // Honest, and an invitation rather than a report of absence. Nothing
        // synthetic is ever seeded into the live product to make this look busy.
        <p className="cm-empty-invite">
          {canWrite
            ? "Здесь пока никто не задал вопрос. Если вы застряли на чём-то — спросите первым: скорее всего, на этом же месте стоит кто-то ещё."
            : "Здесь пока нет обсуждений. Загляните позже — или дойдите до модуля, после которого сможете спросить сами."}
        </p>
      )}

      <Link className="cm-plate__enter" href={`/community/${space.code}`}>
        {canWrite ? "Открыть и задать вопрос" : "Читать обсуждения"}
      </Link>
    </section>
  );
}

/** Not a link, and it does not pretend to be one. */
function LockedPlate({ space }: { space: CommunitySpaceSummary }) {
  return (
    <section className="cm-plate cm-plate--locked" aria-labelledby={`sp-${space.code}`}>
      <div className="cm-plate__top">
        <h2 className="cm-plate__title" id={`sp-${space.code}`}>
          {space.title}
        </h2>
        <span className="cm-plate__requirement">{requirementText(space)}</span>
      </div>
    </section>
  );
}

export function CommunityHome() {
  const [state, setState] = React.useState<
    { kind: "loading" } | { kind: "error"; text: string } | { kind: "ready"; data: CommunityOverview }
  >({ kind: "loading" });

  // A nonce rather than a callback the effect invokes: the effect must not call
  // setState synchronously in its body, and the retry button needs a way to ask
  // for a fresh read. Bumping this re-runs the effect, which is the same shape
  // the support surface already uses.
  const [nonce, setNonce] = React.useState(0);

  React.useEffect(() => {
    // NO AbortController, and that is the fix rather than an omission.
    //
    // COMMUNITY-V1 aborted the in-flight read on cleanup. When React runs an
    // effect, cleans it up and settles — which the App Router does — the abort
    // lands on the read whose `.then` is then skipped because `cancelled` is
    // true, and the surface stays on its skeleton forever with no error and no
    // request in the network panel. Reproduced in a real browser at mobile
    // width: `/support`, which uses the pattern below, loaded its list in the
    // same tab seconds before `/community` failed to load its own.
    //
    // The stale-response guard is the `cancelled` flag alone, exactly as
    // `support-hub.tsx` does it. Aborting a short JSON GET saves nothing worth
    // a permanently stuck surface.
    let cancelled = false;
    void fetchCommunityOverview().then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { kind: "ready", data: result.data }
          : { kind: "error", text: errorText(result.error) },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const retry = React.useCallback(() => {
    setState({ kind: "loading" });
    setNonce((n) => n + 1);
  }, []);

  if (state.kind === "loading") return <CommunitySkeleton plates={1} lines={3} />;

  if (state.kind === "error") {
    return (
      <div className="cm">
        <div className="cm__head">
          <h1>Сообщество</h1>
        </div>
        <ErrorNote text={state.text} />
        <div className="cm-actions">
          <button type="button" className="cm-btn" onClick={retry}>
            Попробовать снова
          </button>
        </div>
      </div>
    );
  }

  const { data } = state;
  const writable = data.spaces.filter((s) => s.canWrite);
  const readable = data.spaces.filter((s) => s.canRead && !s.canWrite);
  const locked = data.spaces.filter((s) => !s.canRead);

  // The rail is bright through the plates the learner holds and dims at the
  // first they do not. Computed from real access, never decorative.
  const held = writable.length + readable.length;
  const railStop = data.spaces.length === 0 ? 0 : Math.round((held / data.spaces.length) * 100);

  return (
    <div className="cm">
      <div className="cm__head">
        <h1>Сообщество</h1>
        {data.currentModuleNumber !== null ? (
          <span className="cm__position">вы на модуле {data.currentModuleNumber}</span>
        ) : null}
      </div>

      <p className="cm__lede">
        Здесь учатся те, кто идёт по той же программе. Спрашивайте о том, что не получается, и
        отвечайте там, где вы уже прошли.
      </p>

      {!data.enrolled ? (
        <p className="cm-note cm-note--muted">
          Сообщество открывается вместе с программой. Начните обучение — и первое пространство
          станет доступным.
        </p>
      ) : null}

      <div className="cm__rail" style={{ ["--cm-rail-stop" as string]: `${railStop}%` }}>
        {[...writable, ...readable].map((space) => (
          <AccessiblePlate key={space.code} space={space} discussions={space.preview} />
        ))}
        {locked.map((space) => (
          <LockedPlate key={space.code} space={space} />
        ))}
      </div>
    </div>
  );
}
