/**
 * §23/§51 — how money is rendered, in exactly one place.
 *
 * A LIST OF (currency, amount) PAIRS IS RENDERED AS A LIST. There is no code
 * path here that adds two buckets together, and none that supplies a currency
 * symbol for a bucket whose currency is null. A deposit whose currency the
 * provider never stated renders as `282.70 (currency not stated by provider)`,
 * which is the truth, rather than as `$282.70`, which is a fabrication.
 *
 * AN EMPTY LIST RENDERS AS `—`, NOT AS `0.00`. No money at all and money
 * totalling zero are different facts, and the second one cannot occur here
 * because a zero amount is not representable.
 */
export type CurrencyTotal = { currency: string | null; amount: string; count: number };

export function Money({ totals }: { totals: CurrencyTotal[] }) {
  if (totals.length === 0) return <span>—</span>;
  return (
    <>
      {totals.map((total, index) => (
        <div key={`${total.currency ?? "unspecified"}-${index}`}>
          <span className="mono">{total.amount}</span>{" "}
          {total.currency !== null ? (
            <span>{total.currency}</span>
          ) : (
            <span className="pill">currency not stated by provider</span>
          )}
        </div>
      ))}
    </>
  );
}

/** A single amount, with the same refusal to invent a unit. */
export function Amount({ amount, currency }: { amount: string | null; currency: string | null }) {
  if (amount === null) return <span>—</span>;
  return (
    <span>
      <span className="mono">{amount}</span>{" "}
      {currency !== null ? currency : <span className="pill">unstated</span>}
    </span>
  );
}

/** A rate, where NULL means "no denominator" and is not 0%. */
export function Rate({ value }: { value: number | null }) {
  if (value === null) return <span className="pill">no data</span>;
  return <span>{(value * 100).toFixed(1)}%</span>;
}
