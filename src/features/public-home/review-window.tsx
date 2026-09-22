"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import {
  DECISION_FIELD,
  DECISION_STRONG,
  DECISION_WEAK,
  REVIEW_ACTION,
  REVIEW_COMMENT,
  REVIEW_CRITERION,
  REVIEW_REASON,
  REVIEW_STAGES,
  reviewStageIndex,
  type ReviewStageId,
} from "@/features/public-home/review-data";

/**
 * THE EVIDENCE, IN THE PRODUCT'S OWN FRAME — `#review`.
 *
 * The section used to carry four authored cards. It now carries one window of
 * the product — the report workspace of L3, «Первые пять demo-сделок», with
 * the real assignment's entries and fields, the real status panel and the
 * real words the learner reads («Отчёт отправлен и ожидает проверки
 * наставника», «Наставник запросил доработку», «Работа принята») — and moves
 * it through the same four states: sent, returned, corrected, accepted. The
 * strip under the window keeps the four states as words, so the argument reads
 * without motion and the tests that pin it (one criterion, one reason, one
 * action, the same field corrected, no financial win) still read the strip.
 *
 * MOTION. When the window is reached the sequence plays once — 1.5s a state,
 * 4.5s in all, the page's one cinematic moment, on the emotional side of the
 * motion rules — and any click on a state stops it. Under reduced motion
 * nothing plays: the window shows the first state and the strip is the
 * control. Without a script the window shows the first state and the strip
 * reads as it always did.
 *
 * THE CARD IS THE TARGET. The button in the title is the control — focusable,
 * `aria-pressed`, the keyboard's way in — but a pointer may land anywhere on
 * the card: the index, the note, the empty surface. Only the object inside
 * the card (the field, the criterion, the accepted note) is content, not a
 * control: it is there to be read, and a click on it changes nothing. A drag
 * that selected text is not a click either.
 */

const HOLD_MS = 1500;
const REDUCED = "(prefers-reduced-motion: reduce)";

/** The five entries of the real assignment, the third the one under review. */
const ENTRIES = [
  { n: "01", asset: "EUR/USD OTC", dir: "▲ Выше" },
  { n: "02", asset: "EUR/USD OTC", dir: "▼ Ниже" },
  { n: "03", asset: "GBP/USD OTC", dir: "▲ Выше" },
  { n: "04", asset: "EUR/USD OTC", dir: "▼ Ниже" },
  { n: "05", asset: "BTC/USD OTC", dir: "▲ Выше" },
] as const;

export function ReviewWindow() {
  const [stage, setStage] = useState<ReviewStageId>("v1");
  const windowRef = useRef<HTMLDivElement | null>(null);
  const playedRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  const stop = useCallback(() => {
    for (const id of timersRef.current) window.clearTimeout(id);
    timersRef.current = [];
  }, []);

  // Play once, when the window is reached, unless motion is reduced. The
  // window itself is observed, not the block with the strip: on a phone the
  // block is taller than the screen and would never show enough of itself.
  useEffect(() => {
    const root = windowRef.current;
    if (!root || !("IntersectionObserver" in window)) return;
    if (window.matchMedia(REDUCED).matches) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || playedRef.current) return;
        playedRef.current = true;
        observer.disconnect();
        const order: ReviewStageId[] = ["feedback", "v2", "accepted"];
        order.forEach((id, i) => {
          timersRef.current.push(window.setTimeout(() => setStage(id), HOLD_MS * (i + 1)));
        });
      },
      { threshold: 0.3 },
    );
    observer.observe(root);
    return () => {
      observer.disconnect();
      stop();
    };
  }, [stop]);

  const choose = useCallback(
    (id: ReviewStageId) => {
      playedRef.current = true;
      stop();
      setStage(id);
    },
    [stop],
  );

  const chooseFromCard = useCallback(
    (event: MouseEvent<HTMLLIElement>, id: ReviewStageId) => {
      const target = event.target as HTMLElement;
      // The button handles itself; the object inside the card is not a control.
      if (target.closest(".evidence__button") || target.closest(".evidence__object")) return;
      if (window.getSelection()?.toString()) return;
      choose(id);
    },
    [choose],
  );

  const at = reviewStageIndex(stage);
  const returned = stage === "feedback";
  const corrected = at >= 2;
  const accepted = stage === "accepted";
  const reason = corrected ? DECISION_STRONG : DECISION_WEAK;

  return (
    <div className="review">
      <div className="pw pw--review" id="review-window" ref={windowRef} data-stage={stage} aria-label={`Окно продукта: отчёт уровня 3, ${REVIEW_STAGES[at]!.title.toLowerCase()}`}>
        <div className="pw__bar">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="pw__mark" src="/brand/ata-logo.svg" alt="" width={362} height={200} />
          <ul className="pw__nav" aria-hidden="true">
            <li>Главная</li>
            <li>Путь</li>
            <li className="is-active">Уроки</li>
            <li>Инструменты</li>
          </ul>
          <span className="pw__level pw-mono">Уровень 3</span>
          <span className="demo-badge pw__badge">Демонстрационный пример</span>
        </div>

        <div className="pw__stage rw">
          <div className="rw__head">
            <p className="rw__crumb">← Уроки · Модуль 01 · Первое знакомство</p>
            <p className="rw__title">
              <span className="pw-mono">03</span> Первые пять demo-сделок <em>Отчёт</em>
            </p>
            <p className="rw__req">
              Требуется: <strong>отчёт по 5 demo-сделкам</strong> · заполнено 5 из 5 записей
            </p>
          </div>

          <div className="rw__grid">
            {/* ------------------------------------------------ the entries */}
            <ol className="rw__entries" aria-label="Записи отчёта">
              {ENTRIES.map((entry) =>
                entry.n === "03" ? (
                  <li key={entry.n} className={`rw__entry rw__entry--open${returned ? " is-flagged" : ""}${corrected ? " is-corrected" : ""}`}>
                    <div className="rw__entry-head">
                      <span className="pw-mono">{entry.n}</span>
                      <strong>Запись 3</strong>
                      <em key={stage} className="rw__chip pw-moment-1">
                        {returned ? "требует внимания" : stage === "v2" ? "доработка 1 из 1" : "заполнена"}
                      </em>
                    </div>
                    <div className="rw__meta">
                      <span>Актив <b>{entry.asset}</b></span>
                      <span>Направление <b>{entry.dir}</b></span>
                      <span>Экспирация <b>3 мин</b></span>
                    </div>
                    <div className="rw__field">
                      <span>{DECISION_FIELD}</span>
                      <strong key={corrected ? "strong" : "weak"}>
                        <i className={corrected ? "pw-typing" : undefined}>{reason}</i>
                      </strong>
                    </div>
                    <div className="rw__meta rw__meta--after">
                      <span>План соблюдён <b>да</b></span>
                      <span>Наблюдение после сделки <b>записано</b></span>
                    </div>
                  </li>
                ) : (
                  <li key={entry.n} className="rw__entry">
                    <span className="pw-mono">{entry.n} ·</span>
                    <strong>{entry.asset}</strong>
                    <span>{entry.dir}</span>
                    <em className="rw__chip">заполнена</em>
                  </li>
                ),
              )}
            </ol>

            {/* --------------------------------------------- the status panel */}
            <aside className="rw__status" aria-label="Статус отчёта">
              {accepted ? (
                <p className="rw__verdict pw-moment-1">✓ Работа принята</p>
              ) : returned ? (
                <div className="rw__feedback pw-moment-1" role="note">
                  <p className="rw__feedback-title">↩︎ Наставник запросил доработку</p>
                  <p><span>Причина:</span> {REVIEW_REASON} · критерий «{REVIEW_CRITERION}»</p>
                  <p>{REVIEW_COMMENT}</p>
                  <p><span>Что сделать:</span> {REVIEW_ACTION}</p>
                </div>
              ) : (
                <p className="rw__state pw-moment-1" key={`state-${stage}`}>
                  {stage === "v1"
                    ? "Отчёт отправлен и ожидает проверки наставника."
                    : "Есть изменения после вердикта — можно отправить на проверку повторно."}
                </p>
              )}

              <ol className="rw__arc" aria-label="Этапы проверки">
                <li>Версия 1 отправлена</li>
                {at >= 1 ? <li className="pw-moment-2">Получен разбор</li> : null}
                {at >= 2 ? <li className="pw-moment-2">Версия 2 отправлена</li> : null}
                {accepted ? <li className="pw-moment-2 is-accepted">Работа принята</li> : null}
              </ol>

              {accepted ? (
                <div className="rw__done pw-moment-3">
                  <p>✓ Отчёт принят — уровень завершён</p>
                  <span className="rw__next">Перейти к следующему уровню →</span>
                </div>
              ) : (
                <span className={`pw-button${stage === "v1" ? " pw-button--quiet" : ""} pw-moment-3`} key={`action-${stage}`}>
                  {stage === "v1" ? "На проверке" : returned ? "Создать исправленную версию" : "Отправить на проверку повторно"}
                </span>
              )}
            </aside>
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------- the strip */}
      <ol className="evidence-track" data-evidence aria-label="Цикл проверки практической работы" data-reveal>
        {REVIEW_STAGES.map((item, index) => (
          <li
            key={item.id}
            data-frame-stage={item.id}
            className={`${item.id === stage ? "is-active" : ""}${index <= at ? " is-reached" : ""}`}
            onClick={(event) => chooseFromCard(event, item.id)}
          >
            <p className="evidence__index">{item.index}</p>
            <h3>
              <button
                type="button"
                className="evidence__button"
                aria-pressed={item.id === stage}
                aria-controls="review-window"
                onClick={() => choose(item.id)}
              >
                {item.title}
              </button>
            </h3>
            {item.id === "v1" ? (
              <div className="evidence__object">
                <p className="dframe__field">{DECISION_FIELD}</p>
                <p className="dframe__value">{DECISION_WEAK}</p>
              </div>
            ) : item.id === "feedback" ? (
              <div className="evidence__object evidence__object--flagged">
                <p className="dframe__field">Критерий · {REVIEW_CRITERION}</p>
                <p className="evidence__verdict">{REVIEW_REASON}</p>
                <p className="evidence__action">{REVIEW_ACTION}</p>
              </div>
            ) : item.id === "v2" ? (
              <div className="evidence__object evidence__object--corrected">
                <p className="dframe__field">{DECISION_FIELD}</p>
                <p className="dframe__value">{DECISION_STRONG}</p>
              </div>
            ) : (
              <div className="evidence__object evidence__object--accepted">
                <p className="evidence__accepted">Условия уровня выполнены</p>
                <p className="evidence__action">Следующий уровень открывается.</p>
              </div>
            )}
            <p className="evidence__note">{item.note}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
