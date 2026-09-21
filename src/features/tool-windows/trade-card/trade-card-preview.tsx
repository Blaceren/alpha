import { draftFromCard, type TradeCard, type TradeCardReference } from "./trade-card-model";
import { TradeCardOutcomes, TradeCardPlanForm, TradeCardStepper } from "./trade-card-parts";

/**
 * What the Trade Card looks like, filled in — shown on the locked page.
 *
 * The same parts the working card renders, read-only, with the presentation's
 * example plan. The values are an example and the page labels them as one;
 * none of it is the learner's data, and nothing here writes.
 */
const EXAMPLE_REFERENCE: TradeCardReference = {
  assets: [{ code: "EURUSD_OTC", label: "EUR/USD OTC", group: "currency_otc" }],
  expiries: [{ code: "M3", label: "3 мин", seconds: 180 }],
};

const EXAMPLE_CARD: TradeCard = {
  id: "example",
  status: "fixed",
  plan: {
    asset: { code: "EURUSD_OTC", label: "EUR/USD OTC" },
    direction: "up",
    amount: "8.00",
    payoutPercent: 90,
    expiry: { code: "M3", label: "3 мин", seconds: 180 },
    entryTime: "14:32",
    reason: "Цена вернулась к уровню поддержки, отмеченному до сессии. Свеча закрылась выше уровня.",
  },
  outcomes: { ifRight: "7.20", ifWrong: "8.00" },
  fixedAt: "2026-01-01T14:32:00.000Z",
  planRevisionCount: 0,
  result: null,
  observation: null,
  savedAt: null,
  cancelledAt: null,
  createdAt: "2026-01-01T14:31:00.000Z",
};

export function TradeCardPreview() {
  return (
    <div className="tw-card" aria-label="Пример заполненной карточки">
      <div className="tw-card__steps">
        <TradeCardStepper step={1} />
      </div>
      <TradeCardPlanForm
        draft={draftFromCard(EXAMPLE_CARD)}
        reference={EXAMPLE_REFERENCE}
        disabled
        fixedAtLabel="14:32"
        idPrefix="tc-example"
      />
      <TradeCardOutcomes outcomes={EXAMPLE_CARD.outcomes} />
    </div>
  );
}
