import Link from "next/link";
import { DECISION_FIELD, DECISION_STRONG } from "@/features/public-home/review-data";

/**
 * THE DECISION, IN THE PRODUCT'S OWN FRAME — `#decide`.
 *
 * The section's device is «many → one»: six borrowed answers recede, the
 * learner's own basis is written. The object that holds that basis in the
 * product is the Trade Card (L5, «План сделки до входа») — the field
 * «Основание входа в сделку» (until 2026-10-06 «Причина входа до сделки»),
 * filled before the trade and fixed on opening. So
 * the frame here is the Trade Card at that moment: the four parameters, the
 * reason being written, «Зафиксировано».
 *
 * The same string as the hero's unfinished field and the evidence's V2, kept
 * in `review-data.ts`; the tests hold that it is one string. Static markup:
 * the sequence (chips, axis, the writing) is CSS on the reframe's `is-visible`.
 *
 * Under the window, since DD-366 (owner, 2026-10-08: «мы помогаем делать это
 * и даём ему этот инструмент»): the sentence that says the tool is the
 * learner's, and the page's one action for it — «Начать путь» for a guest,
 * «Перейти в Академию» for a member (`action`, the hero's own pair).
 */
export function DecisionWindow({ action }: { action: { readonly href: string; readonly label: string } }) {
  return (
    <div className="decision" data-frame-stage="set">
      <div className="pw pw--decide" aria-label="Окно продукта: Trade Card, основание входа записано до сделки">
        <div className="pw__bar">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="pw__mark" src="/brand/ata-logo.svg" alt="" width={362} height={200} />
          <ul className="pw__nav" aria-hidden="true">
            <li>Главная</li>
            <li>Путь</li>
            <li>Уроки</li>
            <li className="is-active">Инструменты</li>
          </ul>
          <span className="pw__level pw-mono">Уровень 5</span>
          <span className="demo-badge pw__badge">Демонстрационный пример</span>
        </div>

        <div className="pw__stage dc">
          <div className="pw-tool__head">
            <p className="pw-tool__name">Trade Card</p>
            <p className="pw-tool__sub">План сделки до входа: актив, направление, экспирация и основание.</p>
          </div>
          <div className="dc__params">
            <span>Актив <b>EUR/USD</b></span>
            <span>Направление <b>▲ Выше</b></span>
            <span>Экспирация <b>3 мин</b></span>
            <span>Payout <b>90 %</b></span>
          </div>
          <div className="dc__field dframe__object">
            <p className="dframe__field">{DECISION_FIELD}</p>
            <p className="dframe__value">
              <i className="dframe__type">{DECISION_STRONG}</i>
            </p>
          </div>
          <div className="dc__foot">
            <p className="pw-mono pw-mono--signal dc__fixed">● Зафиксировано 17:20</p>
            <p className="dc__note">После открытия условия сделки не меняются. Основание остаётся в карточке.</p>
          </div>
        </div>
      </div>
      <p className="decision__statement">
        Этот инструмент вы получаете в ATA и учитесь им пользоваться на своих сделках: сначала
        основание — потом сделка. Так собственное решение становится привычкой.
      </p>
      <Link className="button button--dark decision__action" href={action.href}>
        {action.label}
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M4 10h11M11 6l4 4-4 4" />
        </svg>
      </Link>
    </div>
  );
}
