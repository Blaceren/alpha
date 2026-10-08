import { describe, it, expect } from "vitest";
import { UNSAFE_TEXT } from "@/lib/text/unsafe-text";

describe("UNSAFE_TEXT", () => {
  it("refuses markup that could run", () => {
    for (const text of [
      "<script>x</script>",
      "<img src=x onerror=alert(1)>",
      '<a href="javascript:alert(1)">ссылка</a>',
      "</div>",
      "<br/>",
      "<b>жирный</b>",
      "<svg onload=alert(1)>",
      "нажми onclick = alert(1)",
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
    ]) {
      expect(UNSAFE_TEXT.test(text), text).toBe(true);
    }
  });

  it("accepts how traders write conditions (2026-10-04)", () => {
    for (const text of [
      "цена<EMA20, RSI>70",
      "close<ema и rsi>70",
      "Вход, если цена <EMA20 и RSI >70",
      "если цена <ma50 — продаю, если >ma50 — покупаю",
      "RSI > 70 и цена < EMA",
      "payout >= 80%, сумма <= 2% депозита",
      "Использую data: из календаря",
      "проверка на 1<2>0",
    ]) {
      expect(UNSAFE_TEXT.test(text), text).toBe(false);
    }
  });

  it("stays linear on hostile input", () => {
    const hostile = "<a" + " ".repeat(20_000) + "x".repeat(10);
    const started = Date.now();
    UNSAFE_TEXT.test(hostile);
    UNSAFE_TEXT.test("<a ".repeat(5_000));
    expect(Date.now() - started).toBeLessThan(500);
  });
});
