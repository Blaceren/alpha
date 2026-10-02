/**
 * TOOLS-V2 — the reference lists a learner picks from.
 *
 * OURS, NOT FREE TEXT (owner decision 2026-09-21). A trade card names an asset
 * and an expiry from these lists, so a journal and later statistics can group by
 * them without guessing whether "eurusd otc" and "EUR/USD OTC" are one asset.
 *
 * The lists describe what the learner trades on Pocket — binary options with a
 * fixed expiry and no early close. They carry no price, no payout and no market
 * data: the learner reads those in Pocket and types the payout in themselves.
 *
 * CODES ARE STORED, LABELS ARE NOT. A card persists `code`, so a label can be
 * corrected here without rewriting a single row. A code, once shipped, must
 * never be reused for a different asset.
 */

/**
 * A PAYOUT IS A WHOLE PERCENT FROM 20 TO 99 (owner, 2026-10-02: «можно писать
 * только цифры и от 20 до 99»). One range for every tool that takes a payout —
 * a Trade Card, a journal entry, a Risk Plan, the learner's own minimum in an
 * Entry Check — so a number accepted by one is never refused by the next.
 *
 * The database's own checks are wider (1…100, from the tables' migrations) and
 * stay as they are: they are the storage's guard, this is the product's rule,
 * and nothing saved before the rule is made unreadable by it.
 */
export const PAYOUT_PERCENT = { min: 20, max: 99 } as const;

export type TradingAssetGroup = "currency_otc" | "currency" | "crypto_otc" | "commodity_otc";

export type TradingAsset = {
  readonly code: string;
  readonly label: string;
  readonly group: TradingAssetGroup;
};

export const TRADING_ASSETS = [
  { code: "EURUSD_OTC", label: "EUR/USD OTC", group: "currency_otc" },
  { code: "GBPUSD_OTC", label: "GBP/USD OTC", group: "currency_otc" },
  { code: "USDJPY_OTC", label: "USD/JPY OTC", group: "currency_otc" },
  { code: "AUDUSD_OTC", label: "AUD/USD OTC", group: "currency_otc" },
  { code: "USDCAD_OTC", label: "USD/CAD OTC", group: "currency_otc" },
  { code: "USDCHF_OTC", label: "USD/CHF OTC", group: "currency_otc" },
  { code: "EURGBP_OTC", label: "EUR/GBP OTC", group: "currency_otc" },
  { code: "EURJPY_OTC", label: "EUR/JPY OTC", group: "currency_otc" },
  { code: "GBPJPY_OTC", label: "GBP/JPY OTC", group: "currency_otc" },
  { code: "AUDCAD_OTC", label: "AUD/CAD OTC", group: "currency_otc" },
  { code: "NZDUSD_OTC", label: "NZD/USD OTC", group: "currency_otc" },
  { code: "EURCHF_OTC", label: "EUR/CHF OTC", group: "currency_otc" },
  { code: "EURUSD", label: "EUR/USD", group: "currency" },
  { code: "GBPUSD", label: "GBP/USD", group: "currency" },
  { code: "USDJPY", label: "USD/JPY", group: "currency" },
  { code: "AUDUSD", label: "AUD/USD", group: "currency" },
  { code: "USDCAD", label: "USD/CAD", group: "currency" },
  { code: "USDCHF", label: "USD/CHF", group: "currency" },
  { code: "EURGBP", label: "EUR/GBP", group: "currency" },
  { code: "EURJPY", label: "EUR/JPY", group: "currency" },
  { code: "GBPJPY", label: "GBP/JPY", group: "currency" },
  { code: "BTCUSD_OTC", label: "BTC/USD OTC", group: "crypto_otc" },
  { code: "ETHUSD_OTC", label: "ETH/USD OTC", group: "crypto_otc" },
  { code: "XAUUSD_OTC", label: "Gold OTC", group: "commodity_otc" },
  { code: "XAGUSD_OTC", label: "Silver OTC", group: "commodity_otc" },
] as const satisfies readonly TradingAsset[];

export type ExpiryOption = {
  readonly code: string;
  readonly label: string;
  /** Duration in seconds, so a surface can show when the trade expires. */
  readonly seconds: number;
};

export const EXPIRY_OPTIONS = [
  { code: "S5", label: "5 сек", seconds: 5 },
  { code: "S15", label: "15 сек", seconds: 15 },
  { code: "S30", label: "30 сек", seconds: 30 },
  { code: "M1", label: "1 мин", seconds: 60 },
  { code: "M3", label: "3 мин", seconds: 180 },
  { code: "M5", label: "5 мин", seconds: 300 },
  { code: "M15", label: "15 мин", seconds: 900 },
  { code: "M30", label: "30 мин", seconds: 1800 },
  { code: "H1", label: "1 час", seconds: 3600 },
  { code: "H4", label: "4 часа", seconds: 14400 },
] as const satisfies readonly ExpiryOption[];

export function tradingAssetByCode(code: string): TradingAsset | null {
  return TRADING_ASSETS.find((asset) => asset.code === code) ?? null;
}

export function expiryByCode(code: string): ExpiryOption | null {
  return EXPIRY_OPTIONS.find((expiry) => expiry.code === code) ?? null;
}

/** The lists as a surface receives them. */
export function tradeCardReference() {
  return {
    assets: TRADING_ASSETS.map(({ code, label, group }) => ({ code, label, group })),
    expiries: EXPIRY_OPTIONS.map(({ code, label, seconds }) => ({ code, label, seconds })),
  };
}
