/**
 * AFD-5C1 — the formatters that must not lie.
 *
 * Each block below pins one of the three honesty guarantees from §25, §27 and
 * §29. They are unit tests rather than UI assertions because these are the
 * functions every surface goes through: if `formatRatio(null)` ever returns
 * "0 %", every card, table cell and chart tooltip is wrong at once.
 */
import { describe, expect, it } from "vitest";
import type { AmountAvailability } from "@/data/contracts/api/affiliate-analytics";
import {
  amountUnavailableReason,
  availabilityText,
  describeAnalyticsFailure,
  exactSeconds,
  formatAmount,
  formatDuration,
  formatFollowupSeconds,
  formatSampleSize,
  formatRatio,
  INSUFFICIENT_DATA,
  isRatioUnavailable,
  medianIsUnavailable,
  unavailableReasonLabel,
} from "./analytics-labels";

/* ------------------------------------------------------------------ ratios */

describe("formatRatio", () => {
  it("renders a null denominator as an explicit absence, never as 0 %", () => {
    // The single most important assertion in this file. "No clicks happened"
    // and "a hundred clicks produced nothing" are different business facts.
    expect(formatRatio(null)).toBe(INSUFFICIENT_DATA);
    expect(formatRatio(null)).not.toContain("0");
    expect(isRatioUnavailable(null)).toBe(true);
  });

  it("renders a genuine zero numerator as a real zero", () => {
    expect(formatRatio("0")).toBe("0,00 %");
    expect(isRatioUnavailable("0")).toBe(false);
  });

  it("distinguishes a real zero from an absence", () => {
    expect(formatRatio("0")).not.toBe(formatRatio(null));
  });

  it("renders ordinary rates as percentages", () => {
    expect(formatRatio("0.5")).toBe("50,0 %");
    expect(formatRatio("1")).toBe("100,0 %");
    expect(formatRatio("0.0425")).toBe("4,25 %");
  });

  it("keeps a tiny non-zero rate visible instead of collapsing it to zero", () => {
    // Rounding 0.0004 to "0,00 %" would read as "never happens".
    expect(formatRatio("0.0004")).toBe("< 0,1 %");
  });

  it("treats an unparseable value as unavailable rather than as zero", () => {
    expect(formatRatio("not-a-number")).toBe(INSUFFICIENT_DATA);
  });
});

/* ----------------------------------------------------------------- amounts */

const available: AmountAvailability = {
  amountAggregationAvailable: true,
  amountTotal: "1234.50",
  currencyCode: "EUR",
  unavailableReason: null,
};

const mixed: AmountAvailability = {
  amountAggregationAvailable: false,
  amountTotal: null,
  currencyCode: null,
  unavailableReason: "currency_unspecified_or_mixed",
};

const none: AmountAvailability = {
  amountAggregationAvailable: false,
  amountTotal: null,
  currencyCode: null,
  unavailableReason: "no_confirmed_first_deposits",
};

describe("formatAmount", () => {
  it("renders the total with its exact currency code", () => {
    const text = formatAmount(available);
    expect(text).toContain("EUR");
    expect(text).toContain("1");
    expect(text).toContain("234");
  });

  it("never substitutes USD for an unspecified currency", () => {
    expect(formatAmount(mixed)).toBeNull();
    expect(formatAmount(none)).toBeNull();
  });

  it("returns no number at all when aggregation is unavailable", () => {
    // There is no branch that could produce a bare number: the contract's
    // unavailable variant carries neither a total nor a code.
    expect(formatAmount(mixed)).toBeNull();
  });

  it("explains a mixed or unspecified currency without converting it", () => {
    const reason = amountUnavailableReason("currency_unspecified_or_mixed");
    expect(reason).toContain("валют");
    expect(reason).toContain("Конвертация не выполняется");
  });

  it("explains an empty period separately from a currency problem", () => {
    expect(amountUnavailableReason("no_confirmed_first_deposits")).not.toBe(
      amountUnavailableReason("currency_unspecified_or_mixed"),
    );
  });

  it("uses no revenue, balance, profit or LTV language", () => {
    const strings = [
      formatAmount(available) ?? "",
      amountUnavailableReason("currency_unspecified_or_mixed"),
      amountUnavailableReason("no_confirmed_first_deposits"),
    ].join(" ");
    for (const forbidden of ["выручк", "баланс", "прибыл", "LTV", "revenue", "profit"]) {
      expect(strings.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});

/* --------------------------------------------------------------- durations */

describe("formatDuration", () => {
  it("returns null for an absent median rather than a zero duration", () => {
    expect(formatDuration(null)).toBeNull();
  });

  it("never rounds a non-zero duration down to zero", () => {
    // Half a second is a real median of an even population of whole seconds.
    expect(formatDuration("0.5")).toBe("0,5 сек");
    expect(formatDuration("0.5")).not.toBe("0 сек");
    expect(formatDuration("1.5")).toBe("1,5 сек");
  });

  it("renders an exact zero as zero", () => {
    expect(formatDuration("0")).toBe("0 сек");
  });

  it("scales through seconds, minutes, hours and days", () => {
    expect(formatDuration("45")).toBe("45 сек");
    expect(formatDuration("120")).toBe("2 минуты");
    expect(formatDuration("3600")).toBe("1 час");
    expect(formatDuration("86400")).toBe("1 день");
    expect(formatDuration("172800")).toBe("2 дня");
    expect(formatDuration("432000")).toBe("5 дней");
  });

  it("uses correct Russian plural forms", () => {
    expect(formatDuration("86400")).toContain("день");
    expect(formatDuration("259200")).toContain("дня");
    expect(formatDuration("950400")).toContain("дней");
    expect(formatDuration("60")).toContain("минута");
    expect(formatDuration("180")).toContain("минуты");
    expect(formatDuration("300")).toContain("минут");
  });

  it("preserves the exact source value for accessible text", () => {
    // The display form is a convenience; this is the record.
    expect(exactSeconds("1.5")).toBe("1,5 сек");
    expect(exactSeconds(null)).toBeNull();
  });

  it("uses no average language", () => {
    const strings = ["45", "3600", "86400"].map((s) => formatDuration(s) ?? "").join(" ");
    expect(strings.toLowerCase()).not.toContain("средн");
  });

  it("formats follow-up seconds through the same rules", () => {
    expect(formatFollowupSeconds(86400)).toBe("1 день");
    expect(formatFollowupSeconds(null)).toBeNull();
  });
});

describe("sample size", () => {
  it("is always renderable and correctly pluralised", () => {
    expect(formatSampleSize(1)).toContain("наблюдение");
    expect(formatSampleSize(3)).toContain("наблюдения");
    expect(formatSampleSize(11)).toContain("наблюдений");
    expect(formatSampleSize(0)).toContain("наблюдений");
  });

  it("treats a zero-sample median as unavailable", () => {
    expect(medianIsUnavailable({ medianSeconds: null, sampleSize: 0, negativeDurationCount: 0 })).toBe(
      true,
    );
    expect(medianIsUnavailable({ medianSeconds: "10", sampleSize: 4, negativeDurationCount: 0 })).toBe(
      false,
    );
  });
});

/* ------------------------------------------------------------ availability */

describe("availability copy", () => {
  it("names the actual blocking fact for a redeposit", () => {
    const text = unavailableReasonLabel("provider_transaction_identifier_missing");
    expect(text).toContain("Pocket");
    expect(text).toContain("идентификатор транзакции");
  });

  it("states that current balance is simply not collected", () => {
    expect(unavailableReasonLabel("prohibited_not_collected")).toContain("не собираются");
  });

  it("explains why a direct learner has no acquisition cohort", () => {
    expect(unavailableReasonLabel("acquisition_anchor_absent")).toContain("якоря когорты");
  });

  it("explains why anonymous visitor conversion is unmeasurable", () => {
    expect(
      unavailableReasonLabel("unregistered_visitor_selected_attribution_not_frozen"),
    ).toContain("незарегистрированного");
  });

  it("falls back safely for an unknown reason instead of printing the key", () => {
    const text = unavailableReasonLabel("some_future_reason_key");
    expect(text).not.toContain("some_future_reason_key");
    expect(text).toContain("Недоступно");
  });

  it("renders an available capability as available", () => {
    expect(availabilityText({ available: true })).toBe("Доступно");
    expect(availabilityText({ available: false, reason: "prohibited_not_collected" })).toContain(
      "не собираются",
    );
  });
});

/* ---------------------------------------------------------------- failures */

describe("failure copy", () => {
  it("never prints a raw message key", () => {
    const text = describeAnalyticsFailure({
      status: "invalid_input",
      messageKey: "crm.analytics.some.future.key",
    });
    expect(text).not.toContain("crm.analytics");
  });

  it("maps the bucket cap to an actionable sentence", () => {
    const text = describeAnalyticsFailure({
      status: "bucket_cap_exceeded",
      messageKey: "crm.analytics.bucket_cap_exceeded",
    });
    expect(text).toContain("группировк");
  });

  it("returns nothing for a cancelled request", () => {
    expect(describeAnalyticsFailure({ status: "cancelled" })).toBe("");
  });

  it("explains an expired session", () => {
    expect(describeAnalyticsFailure({ status: "unauthenticated" })).toContain("Сессия истекла");
  });

  it("explains a permission refusal", () => {
    expect(
      describeAnalyticsFailure({ status: "forbidden", messageKey: "crm.affiliates.forbidden" }),
    ).toContain("прав");
  });
});
