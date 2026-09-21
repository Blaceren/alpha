"use client";

/**
 * The Entry Checklist's presentational parts: what the check is for, the nine
 * items and their progress, the verdict, and the checks already kept. No state
 * and no effects; the workspace owns both.
 */
import { Check, CircleCheck, ListChecks, OctagonX } from "lucide-react";
import { AssetOptions, FieldError } from "../trade-card/trade-card-parts";
import {
  itemLabel,
  verdictLine,
  verdictWords,
  type ChecklistAnswers,
  type ChecklistDraft,
  type ChecklistErrors,
  type ChecklistGroup,
  type ChecklistItem,
  type ChecklistState,
  type ChecklistVerdict,
  type EntryCheck,
} from "./checklist-model";

export const checklistFieldId = (field: "asset" | "minPayoutPercent") => `ck-${field}`;
const errorId = (field: "asset" | "minPayoutPercent") => `ck-${field}-error`;

/* --------------------------------------------------------------- the head */

/** What the check is for: the asset, and the learner's own minimum payout. */
export function ChecklistSubject({
  draft,
  reference,
  errors,
  disabled,
  onChange,
}: {
  draft: ChecklistDraft;
  reference: ChecklistState["reference"];
  errors: ChecklistErrors;
  disabled: boolean;
  onChange: (field: "asset" | "minPayoutPercent", value: string) => void;
}) {
  return (
    <div className="ck-subject">
      <div className="tc-field">
        <label className="tc-label" htmlFor={checklistFieldId("asset")}>
          Актив
        </label>
        <select
          id={checklistFieldId("asset")}
          className="tc-input tc-select"
          value={draft.asset}
          onChange={(event) => onChange("asset", event.target.value)}
          disabled={disabled}
          aria-invalid={errors.asset ? true : undefined}
          aria-describedby={errors.asset ? errorId("asset") : undefined}
        >
          <AssetOptions reference={reference} />
        </select>
        <FieldError id={errorId("asset")} message={errors.asset} />
      </div>
      <div className="tc-field">
        <label className="tc-label" htmlFor={checklistFieldId("minPayoutPercent")}>
          Мой минимум payout
        </label>
        <span className="tc-affix" data-side="end">
          <input
            id={checklistFieldId("minPayoutPercent")}
            className="tc-input"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={draft.minPayoutPercent}
            onChange={(event) => onChange("minPayoutPercent", event.target.value)}
            disabled={disabled}
            aria-invalid={errors.minPayoutPercent ? true : undefined}
            aria-describedby={errors.minPayoutPercent ? errorId("minPayoutPercent") : undefined}
          />
          <span className="tc-affix__mark" aria-hidden="true">
            %
          </span>
        </span>
        <FieldError id={errorId("minPayoutPercent")} message={errors.minPayoutPercent} />
      </div>
    </div>
  );
}

/**
 * «EUR/USD OTC · перед входом» and the nine segments, one per item: how far the
 * check has come, never a score.
 */
export function ChecklistProgress({
  items,
  answers,
  assetLabel,
}: {
  items: readonly ChecklistItem[];
  answers: ChecklistAnswers;
  assetLabel: string | null;
}) {
  const confirmed = items.filter((item) => answers[item.code]).length;
  return (
    <div className="ck-progress">
      <p className="ck-progress__head">
        <span className="ck-progress__what">{assetLabel ?? "Актив не выбран"} · перед входом</span>
        <span className="ck-progress__count">
          {confirmed} / {items.length}
        </span>
      </p>
      <span className="ck-progress__bars" aria-hidden="true">
        {items.map((item) => (
          <span key={item.code} className="ck-progress__bar" data-on={answers[item.code] || undefined} />
        ))}
      </span>
    </div>
  );
}

/* -------------------------------------------------------------- the items */

export function ChecklistGroups({
  groups,
  items,
  answers,
  minPayoutPercent,
  disabled,
  onToggle,
}: {
  groups: readonly ChecklistGroup[];
  items: readonly ChecklistItem[];
  answers: ChecklistAnswers;
  minPayoutPercent: number | null;
  disabled: boolean;
  onToggle: (code: string, on: boolean) => void;
}) {
  return (
    <div className="ck-groups">
      {groups.map((group) => {
        const inGroup = items.filter((item) => item.group === group.code);
        if (inGroup.length === 0) return null;
        return (
          <fieldset className="ck-group" key={group.code}>
            <legend className="ck-group__name">{group.label}</legend>
            <ul className="ck-items">
              {inGroup.map((item) => {
                const on = answers[item.code] === true;
                return (
                  <li key={item.code}>
                    <label className="ck-item" data-on={on || undefined}>
                      <input
                        type="checkbox"
                        className="ck-item__input"
                        checked={on}
                        disabled={disabled}
                        onChange={(event) => onToggle(item.code, event.target.checked)}
                      />
                      <span className="ck-item__box" aria-hidden="true">
                        {on ? <Check size={13} strokeWidth={3} /> : null}
                      </span>
                      <span className="ck-item__text">{itemLabel(item, minPayoutPercent)}</span>
                      {/* The space keeps «… стабильна» and «Стоп-фактор» two words when read aloud. */}
                      {item.stop ? (
                        <>
                          {" "}
                          <span className="ck-item__stop">Стоп-фактор</span>
                        </>
                      ) : null}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------ the verdict */

/**
 * `verdict` is null before the first tick: nothing has been answered yet, so the
 * panel says what to do instead of greeting the learner with «не входить» —
 * including right after a kept check, when every item opens again.
 */
export function ChecklistVerdictPanel({
  verdict,
  missingLabel,
}: {
  verdict: ChecklistVerdict | null;
  missingLabel: string | null;
}) {
  if (verdict === null) {
    return (
      <div className="ck-verdict" data-verdict="none" role="status" aria-live="polite">
        <ListChecks aria-hidden="true" size={20} strokeWidth={2} />
        <div>
          <p className="ck-verdict__title">Отметьте, что выполнено</p>
          <p className="ck-verdict__body">
            Пока ничего не отмечено — входить нельзя. Вердикт появится после первой отметки.
          </p>
        </div>
      </div>
    );
  }
  const words = verdictWords(verdict, missingLabel);
  const enter = verdict === "enter";
  return (
    <div className="ck-verdict" data-verdict={enter ? "enter" : "skip"} role="status" aria-live="polite">
      {enter ? (
        <CircleCheck aria-hidden="true" size={20} strokeWidth={2} />
      ) : (
        <OctagonX aria-hidden="true" size={20} strokeWidth={2} />
      )}
      <div>
        <p className="ck-verdict__title">{words.title}</p>
        <p className="ck-verdict__body">{words.body}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------- the kept checks */

export function ChecklistRecent({
  recent,
  items,
  timeOf,
}: {
  recent: readonly EntryCheck[];
  items: readonly ChecklistItem[];
  /** «21 сентября, 14:30» on the learner's clock, or null before the browser has one. */
  timeOf: (iso: string) => string | null;
}) {
  return (
    <section className="ck-recent" aria-labelledby="ck-recent-title">
      <h2 className="tc-section__title" id="ck-recent-title">
        Последние проверки
      </h2>
      {recent.length === 0 ? (
        <p className="ck-recent__empty">Проверок пока нет. Запишите первую перед следующим входом.</p>
      ) : (
        <ol className="ck-recent__list">
          {recent.map((check) => {
            const when = timeOf(check.createdAt);
            return (
              <li className="ck-check" key={check.id} data-verdict={check.verdict === "enter" ? "enter" : "skip"}>
                <span className="ck-check__what">
                  {when ? `${when} · ` : ""}
                  {check.asset.label}
                  {check.minPayoutPercent !== null ? ` · payout от ${check.minPayoutPercent}%` : ""}
                </span>
                <span className="ck-check__verdict">{verdictLine(check, items)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
